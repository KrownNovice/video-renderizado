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
  if (!url) {
    return url;
  }

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
| Baixar arquivo
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

  fs.writeFileSync(
    destino,
    resposta.data
  );

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

function obterDuracaoAudio(audio) {
  return new Promise((resolve, reject) => {
    const processo = spawn(
      "ffprobe",
      [
        "-v",
        "error",

        "-show_entries",
        "format=duration",

        "-of",
        "default=noprint_wrappers=1:nokey=1",

        audio,
      ]
    );

    let resultado = "";
    let erro = "";

    processo.stdout.on(
      "data",
      (data) => {
        resultado += data.toString();
      }
    );

    processo.stderr.on(
      "data",
      (data) => {
        erro += data.toString();
      }
    );

    processo.on(
      "close",
      (code) => {
        if (code !== 0) {
          reject(
            new Error(erro)
          );

          return;
        }

        const duracao =
          parseFloat(
            resultado.trim()
          );

        if (
          !duracao ||
          Number.isNaN(duracao)
        ) {
          reject(
            new Error(
              "Não foi possível descobrir a duração do áudio."
            )
          );

          return;
        }

        resolve(duracao);
      }
    );
  });
}


/*
|--------------------------------------------------------------------------
| Extensão da imagem
|--------------------------------------------------------------------------
*/

function descobrirExtensao(url) {
  const limpa = String(url)
    .split("?")[0]
    .toLowerCase();

  if (
    limpa.endsWith(".png")
  ) {
    return "png";
  }

  if (
    limpa.endsWith(".jpg") ||
    limpa.endsWith(".jpeg")
  ) {
    return "jpg";
  }

  if (
    limpa.endsWith(".webp")
  ) {
    return "webp";
  }

  return "webp";
}


/*
|--------------------------------------------------------------------------
| Tempo das legendas
|--------------------------------------------------------------------------
*/

function formatarTempoASS(segundos) {
  const total = Math.max(
    0,
    Math.round(
      Number(segundos) * 100
    )
  );

  const horas =
    Math.floor(
      total / 360000
    );

  const minutos =
    Math.floor(
      (total % 360000) /
        6000
    );

  const segundosInteiros =
    Math.floor(
      (total % 6000) /
        100
    );

  const centesimos =
    total % 100;

  return `${horas}:${String(
    minutos
  ).padStart(
    2,
    "0"
  )}:${String(
    segundosInteiros
  ).padStart(
    2,
    "0"
  )}.${String(
    centesimos
  ).padStart(
    2,
    "0"
  )}`;
}


/*
|--------------------------------------------------------------------------
| Escapar texto ASS
|--------------------------------------------------------------------------
*/

function escaparTextoASS(texto) {
  return String(texto || "")
    .replace(
      /\\/g,
      "\\\\"
    )
    .replace(
      /{/g,
      "\\{"
    )
    .replace(
      /}/g,
      "\\}"
    )
    .replace(
      /\r?\n/g,
      "\\N"
    );
}


/*
|--------------------------------------------------------------------------
| Criar legenda
|--------------------------------------------------------------------------
*/

function criarLegendaTikTok(
  palavras,
  destino
) {
  const palavrasPorGrupo = 4;

  const validas = palavras
    .filter(
      (item) =>
        item &&
        item.palavra &&
        Number.isFinite(
          Number(item.inicio)
        ) &&
        Number.isFinite(
          Number(item.fim)
        ) &&
        Number(item.fim) >
          Number(item.inicio)
    )
    .map(
      (item) => ({
        palavra:
          String(
            item.palavra
          ),

        inicio:
          Number(
            item.inicio
          ),

        fim:
          Number(
            item.fim
          ),
      })
    )
    .sort(
      (a, b) =>
        a.inicio -
        b.inicio
    );


  if (
    validas.length === 0
  ) {
    throw new Error(
      "Nenhuma palavra válida para criar legenda."
    );
  }


  console.log(
    "Primeira palavra:",
    validas[0]
  );

  console.log(
    "Total de palavras:",
    validas.length
  );


  const cabecalho = `[Script Info]
Title: TikTok Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: TikTok,DejaVu Sans,82,&H00FFFFFF,&H00FFFFFF,&H00000000,&H50000000,-1,0,0,0,100,100,1,0,1,7,2,5,70,70,0,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;


  const eventos = [];


  /*
  |--------------------------------------------------------------------------
  | Criar grupos de 4 palavras
  |--------------------------------------------------------------------------
  */

  for (
    let grupoInicio = 0;
    grupoInicio <
      validas.length;
    grupoInicio +=
      palavrasPorGrupo
  ) {

    const grupo =
      validas.slice(
        grupoInicio,
        grupoInicio +
          palavrasPorGrupo
      );


    /*
    |--------------------------------------------------------------------------
    | Cada palavra recebe um evento real
    |--------------------------------------------------------------------------
    */

    for (
      let j = 0;
      j <
        grupo.length;
      j++
    ) {

      const atual =
        grupo[j];

      const indiceGlobal =
        grupoInicio + j;


      const inicioEvento =
        atual.inicio;


      let fimEvento;


      /*
       * Mantém até a próxima palavra.
       */
      if (
        indiceGlobal + 1 <
        validas.length
      ) {

        fimEvento =
          validas[
            indiceGlobal + 1
          ].inicio;

      } else {

        fimEvento =
          atual.fim;
      }


      /*
       * Segurança
       */
      if (
        fimEvento <=
        inicioEvento
      ) {

        fimEvento =
          atual.fim;
      }


      /*
      |--------------------------------------------------------------------------
      | Montar as 4 palavras
      |--------------------------------------------------------------------------
      */

      const textoGrupo =
        grupo
          .map(
            (
              item,
              posicao
            ) => {

              const palavra =
                escaparTextoASS(
                  item.palavra
                    .toUpperCase()
                );


              /*
               * Palavra atual:
               * AMARELA + maior
               */
              if (
                posicao === j
              ) {

                return (
                  "{\\c&H0000FFFF&" +
                  "\\fs94" +
                  "\\bord8" +
                  "}" +
                  palavra +
                  "{\\rTikTok}"
                );
              }


              /*
               * Palavras restantes
               */
              return palavra;
            }
          )
          .join(" ");


      /*
      |--------------------------------------------------------------------------
      | Centralizar
      |--------------------------------------------------------------------------
      */

      const texto =
        "{\\an5\\pos(540,1320)}" +
        textoGrupo;


      /*
      |--------------------------------------------------------------------------
      | Evento ASS
      |--------------------------------------------------------------------------
      */

      eventos.push(
        `Dialogue: 0,${formatarTempoASS(
          inicioEvento
        )},${formatarTempoASS(
          fimEvento
        )},TikTok,,0,0,0,,${texto}`
      );
    }
  }


  fs.writeFileSync(
    destino,

    `${cabecalho}\n${eventos.join(
      "\n"
    )}`,

    "utf8"
  );


  console.log(
    "Arquivo de legenda:",
    destino
  );

  console.log(
    "Primeiro evento:",
    eventos[0]
  );

  console.log(
    "Quantidade eventos:",
    eventos.length
  );
}


/*
|--------------------------------------------------------------------------
| Página inicial
|--------------------------------------------------------------------------
*/

app.get(
  "/",
  (
    req,
    res
  ) => {

    res.json({
      status:
        "online",

      servico:
        "video-renderizado",

      ffmpeg:
        true,

      legenda:
        "timestamps-resetados",

      versao:
        "6.0",
    });
  }
);


/*
|--------------------------------------------------------------------------
| Health
|--------------------------------------------------------------------------
*/

app.get(
  "/health",
  (
    req,
    res
  ) => {

    res.json({
      ok: true,
    });
  }
);


/*
|--------------------------------------------------------------------------
| Renderizar vídeo
|--------------------------------------------------------------------------
*/

app.post(
  "/render",
  async (
    req,
    res
  ) => {

    const pasta =
      path.join(
        os.tmpdir(),
        `video-${crypto.randomUUID()}`
      );


    fs.mkdirSync(
      pasta,
      {
        recursive:
          true,
      }
    );


    try {

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

        return res
          .status(400)
          .json({
            erro:
              "ID não informado",
          });
      }


      if (
        !Array.isArray(
          imagens
        ) ||
        imagens.length ===
          0
      ) {

        return res
          .status(400)
          .json({
            erro:
              "Nenhuma imagem informada",
          });
      }


      if (!audio) {

        return res
          .status(400)
          .json({
            erro:
              "Áudio não informado",
          });
      }


      console.log(
        "================================"
      );

      console.log(
        "Nova renderização"
      );

      console.log(
        "ID:",
        id
      );

      console.log(
        "Imagens:",
        imagens.length
      );

      console.log(
        "Palavras:",
        palavras.length
      );


      /*
      |--------------------------------------------------------------------------
      | Áudio
      |--------------------------------------------------------------------------
      */

      const audioPath =
        path.join(
          pasta,
          "audio.mp3"
        );


      await baixarArquivo(
        audio,
        audioPath
      );


      /*
      |--------------------------------------------------------------------------
      | Imagens
      |--------------------------------------------------------------------------
      */

      const imagensLocais =
        [];


      for (
        let i = 0;
        i <
          imagens.length;
        i++
      ) {

        const extensao =
          descobrirExtensao(
            imagens[i]
          );


        const destino =
          path.join(
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
      | Duração real do áudio
      |--------------------------------------------------------------------------
      */

      const duracaoAudio =
        await obterDuracaoAudio(
          audioPath
        );


      console.log(
        "Duração:",
        duracaoAudio
      );


      const duracaoImagem =
        duracaoAudio /
        imagensLocais.length;


      /*
      |--------------------------------------------------------------------------
      | Concat
      |--------------------------------------------------------------------------
      */

      const concatPath =
        path.join(
          pasta,
          "imagens.txt"
        );


      let concat = "";


      for (
        const imagem
        of imagensLocais
      ) {

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


      const ultimaImagem =
        imagensLocais[
          imagensLocais.length -
            1
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
      |
      | Vídeo base com TEMPO RESETADO
      |--------------------------------------------------------------------------
      */

      const videoBasePath =
        path.join(
          pasta,
          `${id}-base.mp4`
        );


      console.log(
        "Criando vídeo base..."
      );


      await executar(
        "ffmpeg",
        [

          "-y",


          /*
           * Gerar timestamps
           */
          "-fflags",
          "+genpts",


          /*
           * Imagens
           */
          "-f",
          "concat",

          "-safe",
          "0",

          "-i",
          concatPath,


          /*
           * Áudio
           */
          "-i",
          audioPath,


          /*
           * IMPORTANTÍSSIMO
           *
           * Reset do relógio do vídeo.
           */
          "-vf",

          "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=24,format=yuv420p",


          /*
           * Reset do relógio do áudio.
           */
          "-af",

          "asetpts=PTS-STARTPTS",


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
           * FPS constante
           */
          "-fps_mode",
          "cfr",


          /*
           * Eliminar timestamp negativo
           */
          "-avoid_negative_ts",
          "make_zero",


          /*
           * Finalizar no menor stream
           */
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
        "Vídeo base criado."
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
      | ETAPA 2
      |
      | Aplicar legenda sobre vídeo com PTS RESETADO
      |--------------------------------------------------------------------------
      */

      if (
        Array.isArray(
          palavras
        ) &&
        palavras.length >
          0
      ) {

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
          "Aplicando legenda..."
        );


        await executar(
          "ffmpeg",
          [

            "-y",


            /*
             * Gerar timestamps novamente
             */
            "-fflags",
            "+genpts",


            "-i",
            videoBasePath,


            /*
             * RESETAR NOVAMENTE
             *
             * Depois aplicar legenda.
             */
            "-vf",

            `setpts=PTS-STARTPTS,subtitles=${legendaPath}`,


            "-c:v",
            "libx264",


            "-preset",
            "veryfast",


            "-crf",
            "23",


            "-threads",
            "2",


            /*
             * Áudio não precisa
             * ser reencodado.
             */
            "-c:a",
            "copy",


            /*
             * Timestamp zero
             */
            "-avoid_negative_ts",
            "make_zero",


            "-movflags",
            "+faststart",


            outputPath,
          ]
        );


        console.log(
          "Legenda aplicada."
        );


      } else {


        console.log(
          "Sem legendas."
        );


        fs.copyFileSync(
          videoBasePath,
          outputPath
        );
      }


      /*
      |--------------------------------------------------------------------------
      | Validar MP4
      |--------------------------------------------------------------------------
      */

      if (
        !fs.existsSync(
          outputPath
        )
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
        "MP4:",
        tamanho,
        "bytes"
      );


      /*
      |--------------------------------------------------------------------------
      | Enviar arquivo
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


      stream.pipe(
        res
      );


      const limpar =
        () => {

          try {

            fs.rmSync(
              pasta,
              {
                recursive:
                  true,

                force:
                  true,
              }
            );

          } catch {}

        };


      stream.on(
        "close",
        limpar
      );


      stream.on(
        "error",
        limpar
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
            recursive:
              true,

            force:
              true,
          }
        );

      } catch {}


      if (
        !res.headersSent
      ) {

        res
          .status(500)
          .json({

            erro:
              "Erro ao renderizar vídeo",

            detalhes:
              error.message,
          });
      }
    }
  }
);


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
