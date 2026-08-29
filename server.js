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
| Extensão da imagem
|--------------------------------------------------------------------------
*/

function descobrirExtensao(url) {
  const limpa = url
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

  /*
   * Caso não seja possível identificar,
   * usamos WEBP como padrão.
   */
  return "webp";
}

/*
|--------------------------------------------------------------------------
| Rota inicial
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    status: "online",
    servico: "video-renderizado",
    ffmpeg: true,
  });
});

/*
|--------------------------------------------------------------------------
| Health check
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
    console.log("Nova renderização recebida.");

    const {
      id,
      imagens,
      audio,
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
    console.log("Quantidade imagens:", imagens.length);

    /*
    |--------------------------------------------------------------------------
    | Baixar áudio
    |--------------------------------------------------------------------------
    */

    const audioPath =
      path.join(pasta, "audio.mp3");

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
    | Obter duração do áudio
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
    | Criar arquivo concat
    |--------------------------------------------------------------------------
    */

    const concatPath =
      path.join(
        pasta,
        "imagens.txt"
      );

    let concat = "";

    imagensLocais.forEach(
      (imagem) => {
        /*
         * Caminho escapado para concat do FFmpeg
         */
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

    /*
     * O FFmpeg concat precisa repetir
     * a última imagem.
     */
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
      concat
    );

    /*
    |--------------------------------------------------------------------------
    | Arquivo final
    |--------------------------------------------------------------------------
    */

    const outputPath =
      path.join(
        pasta,
        `${id}.mp4`
      );

    /*
    |--------------------------------------------------------------------------
    | FFmpeg
    |--------------------------------------------------------------------------
    |
    | IMPORTANTE:
    |
    | - 1080x1920
    | - 24 fps
    | - somente 2 threads
    | - preset ultrafast
    |
    | Isso reduz bastante o consumo
    | de memória/CPU no Railway.
    |
    */

    console.log(
      "Iniciando FFmpeg..."
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
         * Mantém a foto inteira.
         * Coloca bordas quando necessário.
         */
        "-vf",
        [
          "scale=1080:1920:force_original_aspect_ratio=decrease",
          "pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
          "fps=24",
          "format=yuv420p",
        ].join(","),

        /*
         * Vídeo
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
         * Finalizar junto com áudio
         */
        "-shortest",

        /*
         * Melhor compatibilidade
         * com redes sociais.
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
    | Validar arquivo
    |--------------------------------------------------------------------------
    */

    if (
      !fs.existsSync(outputPath)
    ) {
      throw new Error(
        "FFmpeg terminou mas o MP4 não foi encontrado."
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
        console.log(
          "Download concluído."
        );

        fs.rmSync(
          pasta,
          {
            recursive: true,
            force: true,
          }
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
