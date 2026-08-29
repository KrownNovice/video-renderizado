import express from "express";
import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import crypto from "crypto";

const app = express();

app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 3000;

/*
|--------------------------------------------------------------------------
| Executar comandos
|--------------------------------------------------------------------------
*/

function executar(comando, args) {
  return new Promise((resolve, reject) => {
    const processo = spawn(comando, args);

    let erro = "";

    processo.stderr.on("data", (data) => {
      const texto = data.toString();

      erro += texto;
      console.log(texto);
    });

    processo.on("error", (error) => {
      reject(error);
    });

    processo.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Processo finalizado com código ${code}\n${erro}`
          )
        );
      }
    });
  });
}

/*
|--------------------------------------------------------------------------
| Converter links do Google Drive
|--------------------------------------------------------------------------
*/

function normalizarGoogleDrive(url) {
  if (!url) return url;

  if (!url.includes("drive.google.com")) {
    return url;
  }

  const match =
    url.match(/\/file\/d\/([^/]+)/) ||
    url.match(/[?&]id=([^&]+)/);

  if (match?.[1]) {
    return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  }

  return url;
}

/*
|--------------------------------------------------------------------------
| Baixar arquivos
|--------------------------------------------------------------------------
*/

async function baixarArquivo(url, destino) {
  const urlFinal = normalizarGoogleDrive(url);

  console.log("Baixando:", urlFinal);

  const resposta = await axios({
    method: "GET",
    url: urlFinal,
    responseType: "arraybuffer",
    maxRedirects: 10,
    timeout: 60000,
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });

  fs.writeFileSync(destino, resposta.data);

  console.log(
    "Arquivo salvo:",
    destino,
    resposta.data.length,
    "bytes"
  );
}

/*
|--------------------------------------------------------------------------
| Descobrir duração do áudio
|--------------------------------------------------------------------------
*/

async function obterDuracaoAudio(audio) {
  return new Promise((resolve, reject) => {
    const processo = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audio,
    ]);

    let resultado = "";
    let erro = "";

    processo.stdout.on("data", (data) => {
      resultado += data.toString();
    });

    processo.stderr.on("data", (data) => {
      erro += data.toString();
    });

    processo.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(erro));
        return;
      }

      const duracao = parseFloat(resultado.trim());

      if (!duracao || Number.isNaN(duracao)) {
        reject(
          new Error(
            "Não foi possível descobrir a duração do áudio."
          )
        );
        return;
      }

      resolve(duracao);
    });
  });
}

/*
|--------------------------------------------------------------------------
| Descobrir extensão da imagem
|--------------------------------------------------------------------------
*/

function descobrirExtensao(url) {
  const limpa = String(url)
    .split("?")[0]
    .toLowerCase();

  if (limpa.endsWith(".png")) {
    return "png";
  }

  if (
    limpa.endsWith(".jpg") ||
    limpa.endsWith(".jpeg")
  ) {
    return "jpg";
  }

  if (limpa.endsWith(".webp")) {
    return "webp";
  }

  return "webp";
}

/*
|--------------------------------------------------------------------------
| Legendas
|--------------------------------------------------------------------------
*/

function formatarTempoASS(segundos) {
  const total = Math.max(
    0,
    Math.round(Number(segundos) * 100)
  );

  const horas = Math.floor(total / 360000);

  const minutos = Math.floor(
    (total % 360000) / 6000
  );

  const segundosInteiros = Math.floor(
    (total % 6000) / 100
  );

  const centesimos = total % 100;

  return `${horas}:${String(minutos).padStart(
    2,
    "0"
  )}:${String(segundosInteiros).padStart(
    2,
    "0"
  )}.${String(centesimos).padStart(2, "0")}`;
}

function escaparTextoASS(texto) {
  return String(texto || "")
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function criarArquivoLegendaASS(
  legendas,
  destino
) {
  const cabecalho = `[Script Info]
Title: Legendas TikTok
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: TikTok,DejaVu Sans,76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,1,2,80,80,300,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;

  const eventos = legendas
    .filter(
      (item) =>
        item &&
        item.texto &&
        Number(item.fim) >
          Number(item.inicio)
    )
    .map((item) => {
      const inicio =
        formatarTempoASS(item.inicio);

      const fim =
        formatarTempoASS(item.fim);

      const texto =
        escaparTextoASS(item.texto);

      return `Dialogue: 0,${inicio},${fim},TikTok,,0,0,0,,${texto}`;
    })
    .join("\n");

  fs.writeFileSync(
    destino,
    `${cabecalho}\n${eventos}`,
    "utf8"
  );

  console.log(
    "Arquivo de legenda criado:",
    destino
  );
}

/*
|--------------------------------------------------------------------------
| Página inicial
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    status: "online",
    servico: "video-renderizado",
    ffmpeg: true,
    legendas: true,
  });
});

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/health", (req, res) => {
  res.json({
    ok: true,
  });
});

/*
|--------------------------------------------------------------------------
| Renderizar vídeo
|--------------------------------------------------------------------------
*/

app.post("/render", async (req, res) => {
  const pasta = path.join(
    os.tmpdir(),
    `video-${crypto.randomUUID()}`
  );

  fs.mkdirSync(pasta, {
    recursive: true,
  });

  try {
    console.log(
      "Nova renderização recebida."
    );

    const {
      id,
      imagens,
      audio,
      legendas = [],
    } = req.body;

    /*
    |--------------------------------------------------------------------------
    | Validação
    |--------------------------------------------------------------------------
    */

    if (!id) {
      return res.status(400).json({
        erro: "ID não informado",
      });
    }

    if (
      !Array.isArray(imagens) ||
      imagens.length === 0
    ) {
      return res.status(400).json({
        erro: "Nenhuma imagem informada",
      });
    }

    if (!audio) {
      return res.status(400).json({
        erro: "Áudio não informado",
      });
    }

    console.log("ID:", id);

    console.log(
      "Quantidade de imagens:",
      imagens.length
    );

    console.log(
      "Quantidade de legendas:",
      Array.isArray(legendas)
        ? legendas.length
        : 0
    );

    /*
    |--------------------------------------------------------------------------
    | Baixar áudio
    |--------------------------------------------------------------------------
    */

    const audioPath = path.join(
      pasta,
      "audio.mp3"
    );

    await baixarArquivo(
      audio,
      audioPath
    );

    /*
    |--------------------------------------------------------------------------
    | Baixar imagens
    |--------------------------------------------------------------------------
    */

    const imagensLocais = [];

    for (
      let i = 0;
      i < imagens.length;
      i++
    ) {
      const extensao =
        descobrirExtensao(imagens[i]);

      const destino = path.join(
        pasta,
        `imagem-${i}.${extensao}`
      );

      await baixarArquivo(
        imagens[i],
        destino
      );

      imagensLocais.push(destino);
    }

    /*
    |--------------------------------------------------------------------------
    | Duração do áudio
    |--------------------------------------------------------------------------
    */

    const duracaoAudio =
      await obterDuracaoAudio(audioPath);

    console.log(
      "Duração do áudio:",
      duracaoAudio
    );

    /*
    |--------------------------------------------------------------------------
    | Tempo de cada imagem
    |--------------------------------------------------------------------------
    */

    const duracaoImagem =
      duracaoAudio /
      imagensLocais.length;

    console.log(
      "Tempo por imagem:",
      duracaoImagem
    );

    /*
    |--------------------------------------------------------------------------
    | Arquivo concat
    |--------------------------------------------------------------------------
    */

    const concatPath = path.join(
      pasta,
      "imagens.txt"
    );

    let concat = "";

    imagensLocais.forEach(
      (imagem) => {
        const imagemEscapada =
          imagem.replace(
            /'/g,
            "'\\''"
          );

        concat +=
          `file '${imagemEscapada}'\n`;

        concat +=
          `duration ${duracaoImagem}\n`;
      }
    );

    const ultimaImagem =
      imagensLocais[
        imagensLocais.length - 1
      ].replace(
        /'/g,
        "'\\''"
      );

    concat +=
      `file '${ultimaImagem}'\n`;

    fs.writeFileSync(
      concatPath,
      concat,
      "utf8"
    );

    /*
    |--------------------------------------------------------------------------
    | Criar legenda
    |--------------------------------------------------------------------------
    */

    const legendaPath = path.join(
      pasta,
      "legendas.ass"
    );

    let filtroVideo = [
      "scale=1080:1920:force_original_aspect_ratio=decrease",
      "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
      "fps=24",
    ].join(",");

    if (
      Array.isArray(legendas) &&
      legendas.length > 0
    ) {
      criarArquivoLegendaASS(
        legendas,
        legendaPath
      );

      filtroVideo +=
        `,subtitles=${legendaPath}`;
    }

    filtroVideo +=
      ",format=yuv420p";

    /*
    |--------------------------------------------------------------------------
    | Arquivo final
    |--------------------------------------------------------------------------
    */

    const outputPath = path.join(
      pasta,
      `${id}.mp4`
    );

    /*
    |--------------------------------------------------------------------------
    | FFmpeg
    |--------------------------------------------------------------------------
    */

    console.log(
      "Iniciando FFmpeg..."
    );

    console.log(
      "Filtro:",
      filtroVideo
    );

    await executar(
      "ffmpeg",
      [
        "-y",

        "-f",
        "concat",

        "-safe",
        "0",

        "-i",
        concatPath,

        "-i",
        audioPath,

        /*
         * Vídeo + legenda
         */
        "-vf",
        filtroVideo,

        /*
         * Codec de vídeo
         */
        "-c:v",
        "libx264",

        "-preset",
        "ultrafast",

        "-crf",
        "25",

        "-threads",
        "2",

        /*
         * Áudio
         */
        "-c:a",
        "aac",

        "-ar",
        "48000",

        "-b:a",
        "128k",

        /*
         * Termina junto com o áudio
         */
        "-shortest",

        /*
         * Compatibilidade
         */
        "-movflags",
        "+faststart",

        outputPath,
      ]
    );

    console.log(
      "FFmpeg terminou."
    );

    /*
    |--------------------------------------------------------------------------
    | Validar vídeo
    |--------------------------------------------------------------------------
    */

    if (
      !fs.existsSync(outputPath)
    ) {
      throw new Error(
        "FFmpeg terminou, mas o MP4 não foi encontrado."
      );
    }

    const tamanho =
      fs.statSync(
        outputPath
      ).size;

    console.log(
      "Vídeo criado:",
      tamanho,
      "bytes"
    );

    /*
    |--------------------------------------------------------------------------
    | Retornar MP4
    |--------------------------------------------------------------------------
    */

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Length",
      tamanho
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${id}.mp4"`
    );

    const stream =
      fs.createReadStream(
        outputPath
      );

    stream.pipe(res);

    const limparPasta = () => {
      try {
        fs.rmSync(
          pasta,
          {
            recursive: true,
            force: true,
          }
        );

        console.log(
          "Arquivos temporários removidos."
        );
      } catch (error) {
        console.log(
          "Erro ao limpar pasta temporária:",
          error.message
        );
      }
    };

    stream.on(
      "close",
      limparPasta
    );

  } catch (error) {
    console.error(
      "ERRO:",
      error
    );

    try {
      fs.rmSync(
        pasta,
        {
          recursive: true,
          force: true,
        }
      );
    } catch {}

    if (!res.headersSent) {
      res.status(500).json({
        erro:
          "Erro ao renderizar vídeo",

        detalhes:
          error.message,
      });
    }
  }
});

/*
|--------------------------------------------------------------------------
| Iniciar servidor
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Renderizador online na porta ${PORT}`
    );
  }
);
