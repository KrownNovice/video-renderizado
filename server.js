import express from "express";
import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import crypto from "crypto";

const app = express();

app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

function executar(comando, args) {
  return new Promise((resolve, reject) => {
    const processo = spawn(comando, args);

    let erro = "";

    processo.stderr.on("data", (data) => {
      erro += data.toString();
    });

    processo.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(erro));
      }
    });
  });
}

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

async function baixarArquivo(url, destino) {
  const urlFinal = normalizarGoogleDrive(url);

  const resposta = await axios({
    method: "GET",
    url: urlFinal,
    responseType: "arraybuffer",
    maxRedirects: 10,
  });

  fs.writeFileSync(destino, resposta.data);
}

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

      resolve(parseFloat(resultado.trim()));
    });
  });
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    servico: "video-renderizado",
  });
});

app.post("/render", async (req, res) => {
  const pasta = path.join(
    os.tmpdir(),
    `video-${crypto.randomUUID()}`
  );

  fs.mkdirSync(pasta, { recursive: true });

  try {
    const {
      id,
      imagens,
      audio,
    } = req.body;

    if (!id) {
      return res.status(400).json({
        erro: "ID não informado",
      });
    }

    if (!Array.isArray(imagens) || imagens.length === 0) {
      return res.status(400).json({
        erro: "Nenhuma imagem informada",
      });
    }

    if (!audio) {
      return res.status(400).json({
        erro: "Áudio não informado",
      });
    }

    const audioPath = path.join(pasta, "audio.mp3");

    await baixarArquivo(audio, audioPath);

    const imagensLocais = [];

    for (let i = 0; i < imagens.length; i++) {
      const extensao =
        imagens[i].toLowerCase().includes(".png")
          ? "png"
          : imagens[i].toLowerCase().includes(".jpg") ||
            imagens[i].toLowerCase().includes(".jpeg")
          ? "jpg"
          : "webp";

      const destino = path.join(
        pasta,
        `imagem-${i}.${extensao}`
      );

      await baixarArquivo(imagens[i], destino);

      imagensLocais.push(destino);
    }

    const duracaoAudio =
      await obterDuracaoAudio(audioPath);

    const duracaoImagem =
      duracaoAudio / imagensLocais.length;

    const concatPath =
      path.join(pasta, "imagens.txt");

    let concat = "";

    imagensLocais.forEach((imagem) => {
      concat += `file '${imagem}'\n`;
      concat += `duration ${duracaoImagem}\n`;
    });

    concat += `file '${
      imagensLocais[imagensLocais.length - 1]
    }'\n`;

    fs.writeFileSync(concatPath, concat);

    const outputPath =
      path.join(pasta, `${id}.mp4`);

    await executar("ffmpeg", [
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
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p",

      "-c:v",
      "libx264",

      "-preset",
      "veryfast",

      "-crf",
      "23",

      "-c:a",
      "aac",

      "-b:a",
      "192k",

      "-shortest",

      "-movflags",
      "+faststart",

      outputPath,
    ]);

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${id}.mp4"`
    );

    const stream =
      fs.createReadStream(outputPath);

    stream.pipe(res);

    stream.on("close", () => {
      fs.rmSync(pasta, {
        recursive: true,
        force: true,
      });
    });

  } catch (error) {
    console.error(error);

    fs.rmSync(pasta, {
      recursive: true,
      force: true,
    });

    res.status(500).json({
      erro: "Erro ao renderizar vídeo",
      detalhes: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Renderizador rodando na porta ${PORT}`
  );
});
