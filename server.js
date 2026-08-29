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

    processo.on("error", reject);

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
| Google Drive
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
| Download
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
| Duração do áudio
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
| Extensão das imagens
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
| Tempo ASS
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

/*
|--------------------------------------------------------------------------
| Criar legenda dinâmica estilo TikTok
|--------------------------------------------------------------------------
*/

function criarLegendaTikTok(
  palavras,
  destino
) {
  const palavrasPorGrupo = 4;

  const validas = palavras.filter(
    (item) =>
      item &&
      item.palavra &&
      Number(item.fim) >
        Number(item.inicio)
  );

  const cabecalho = `[Script Info]
Title: TikTok Dynamic Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: TikTok,DejaVu Sans,76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,2,80,80,360,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;

  const eventos = validas.map(
    (item, index) => {
      const inicio =
        formatarTempoASS(item.inicio);

      const fim =
        formatarTempoASS(item.fim);

      const grupoInicio =
        Math.floor(
          index / palavrasPorGrupo
        ) * palavrasPorGrupo;

      const grupo = validas.slice(
        grupoInicio,
        grupoInicio +
          palavrasPorGrupo
      );

      const textoGrupo = grupo
        .map((palavraItem, posicao) => {
          const indiceGlobal =
            grupoInicio + posicao;

          const palavra =
            escaparTextoASS(
              String(
                palavraItem.palavra
              ).toUpperCase()
            );

          /*
           * Palavra que está sendo falada:
           * amarela + maior + efeito pop.
           */
          if (
            indiceGlobal === index
          ) {
            return (
              "{\\c&H0000FFFF&" +
              "\\fs90" +
              "\\fscx108\\fscy108" +
              "\\t(0,120,\\fscx118\\fscy118)" +
              "\\t(120,260,\\fscx108\\fscy108)" +
              "}" +
              palavra +
              "{\\rTikTok}"
            );
          }

          return palavra;
        })
        .join(" ");

      return `Dialogue: 0,${inicio},${fim},TikTok,,0,0,0,,${textoGrupo}`;
    }
  );

  fs.writeFileSync(
    destino,
    `${cabecalho}\n${eventos.join("\n")}`,
    "utf8"
  );

  console.log(
    "Legenda TikTok criada:",
    destino
  );

  console.log(
    "Quantidade de palavras:",
    validas.length
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
    legenda: "tiktok-palavra-por-palavra",
    versao: "3.0",
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
  });
});

/*
|--------------------------------------------------------------------------
| Render
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
      palavras = [],
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
        erro:
          "Nenhuma imagem informada",
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
      "Quantidade de palavras:",
      Array.isArray(palavras)
        ? palavras.length
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
        descobrirExtensao(
          imagens[i]
        );

      const destino = path.join(
        pasta,
        `imagem-${i}.${extensao}`
      );

      await baixarArquivo(
        imagens[i],
        destino
      );

      imagensLocais.push(
        destino
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Duração do áudio
    |--------------------------------------------------------------------------
    */

    const duracaoAudio =
      await obterDuracaoAudio(
        audioPath
      );

    const duracaoImagem =
      duracaoAudio /
      imagensLocais.length;

    console.log(
      "Duração áudio:",
      duracaoAudio
    );

    console.log(
      "Duração por imagem:",
      duracaoImagem
    );

    /*
    |--------------------------------------------------------------------------
    | Criar concat
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
    | ETAPA 1
    | Criar vídeo base
    |--------------------------------------------------------------------------
    */

    const videoBasePath =
      path.join(
        pasta,
        `${id}-base.mp4`
      );

    console.log(
      "ETAPA 1: criando vídeo base..."
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

        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=24,format=yuv420p",

        "-c:v",
        "libx264",

        "-preset",
        "ultrafast",

        "-crf",
        "25",

        "-threads",
        "2",

        "-c:a",
        "aac",

        "-ar",
        "48000",

        "-b:a",
        "128k",

        "-shortest",

        "-movflags",
        "+faststart",

        videoBasePath,
      ]
    );

    if (
      !fs.existsSync(
        videoBasePath
      )
    ) {
      throw new Error(
        "Vídeo base não foi criado."
      );
    }

    console.log(
      "ETAPA 1 concluída."
    );

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
    | ETAPA 2
    | Aplicar legenda dinâmica
    |--------------------------------------------------------------------------
    */

    if (
      Array.isArray(palavras) &&
      palavras.length > 0
    ) {
      console.log(
        "ETAPA 2: criando legenda TikTok..."
      );

      const legendaPath =
        path.join(
          pasta,
          "legendas.ass"
        );

      criarLegendaTikTok(
        palavras,
        legendaPath
      );

      console.log(
        "ETAPA 2: aplicando legenda..."
      );

      await executar(
        "ffmpeg",
        [
          "-y",

          "-i",
          videoBasePath,

          "-vf",
          `subtitles='${legendaPath}'`,

          "-c:v",
          "libx264",

          "-preset",
          "veryfast",

          "-crf",
          "23",

          "-threads",
          "2",

          "-c:a",
          "copy",

          "-movflags",
          "+faststart",

          outputPath,
        ]
      );

      console.log(
        "ETAPA 2 concluída."
      );
    } else {
      console.log(
        "Nenhuma palavra recebida."
      );

      fs.copyFileSync(
        videoBasePath,
        outputPath
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Validar vídeo final
    |--------------------------------------------------------------------------
    */

    if (
      !fs.existsSync(outputPath)
    ) {
      throw new Error(
        "MP4 final não foi criado."
      );
    }

    const tamanho =
      fs.statSync(
        outputPath
      ).size;

    console.log(
      "Vídeo final:",
      tamanho,
      "bytes"
    );

    /*
    |--------------------------------------------------------------------------
    | Responder MP4
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

    stream.on(
      "close",
      () => {
        try {
          fs.rmSync(
            pasta,
            {
              recursive: true,
              force: true,
            }
          );
        } catch {}

        console.log(
          "Arquivos temporários removidos."
        );
      }
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
| Servidor
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
