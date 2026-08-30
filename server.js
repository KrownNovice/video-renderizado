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
| Formatar tempo ASS
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
| Criar legenda TikTok
|--------------------------------------------------------------------------
|
| - Usa timestamps REAIS da OpenAI
| - 4 palavras ficam visíveis
| - Palavra atual fica amarela e maior
| - Cada palavra tem seu próprio evento
|
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


  if (validas.length === 0) {
    throw new Error(
      "Nenhuma palavra válida para criar legenda."
    );
  }


  console.log(
    "Primeira palavra:",
    validas[0]
  );

  console.log(
    "Última palavra:",
    validas[
      validas.length - 1
    ]
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
  | Grupos de 4 palavras
  |--------------------------------------------------------------------------
  */

  for (
    let grupoInicio = 0;
    grupoInicio < validas.length;
    grupoInicio += palavrasPorGrupo
  ) {

    const grupo =
      validas.slice(
        grupoInicio,
        grupoInicio +
          palavrasPorGrupo
      );


    /*
    |--------------------------------------------------------------------------
    | Um evento por palavra
    |--------------------------------------------------------------------------
    */

    for (
      let j = 0;
      j < grupo.length;
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
       * A legenda atual continua
       * até a próxima palavra começar.
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
       * Segurança para tempos iguais.
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
      | Montar texto
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
               * Palavra falada agora.
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


              return palavra;
            }
          )
          .join(" ");


      /*
       * Centralizado.
       */
      const texto =
        "{\\an5\\pos(540,1320)}" +
        textoGrupo;


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
    "Legenda criada:",
    destino
  );

  console.log(
    "Primeiro evento:",
    eventos[0]
  );

  console.log(
    "Eventos:",
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
        "timestamps-reais",

      duracao:
        "corrigida",

      versao:
        "6.1",

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
| Render
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
      | Validar
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
        "=============================="
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
        Array.isArray(
          palavras
        )
          ? palavras.length
          : 0
      );


      /*
      |--------------------------------------------------------------------------
      | Baixar áudio
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
      | Baixar imagens
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
        "Duração do áudio:",
        duracaoAudio
      );


      /*
      |--------------------------------------------------------------------------
      | Duração de cada imagem
      |--------------------------------------------------------------------------
      */

      const duracaoImagem =
        duracaoAudio /
        imagensLocais.length;


      console.log(
        "Duração por imagem:",
        duracaoImagem
      );


      /*
      |--------------------------------------------------------------------------
      | Arquivo concat
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


      /*
       * Repetir a última imagem
       * é necessário para concat
       * respeitar sua duração.
       */
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


      console.log(
        "Concat criado:"
      );

      console.log(
        concat
      );


      /*
      |--------------------------------------------------------------------------
      | ETAPA 1
      |
      | Criar vídeo base
      |--------------------------------------------------------------------------
      */

      const videoBasePath =
        path.join(
          pasta,
          `${id}-base.mp4`
        );


      console.log(
        "ETAPA 1 - vídeo base..."
      );


      await executar(
        "ffmpeg",
        [

          "-y",


          /*
           * NÃO usar +genpts aqui.
           *
           * Ele estava destruindo a duração
           * do concat das imagens.
           */


          "-f",
          "concat",


          "-safe",
          "0",


          "-i",
          concatPath,


          "-i",
          audioPath,


          /*
           * Resetamos apenas PTS,
           * sem recriar timestamps.
           */
          "-vf",

          "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=24,format=yuv420p",


          /*
           * Áudio também começa no 0.
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
           * Terminar junto com
           * o stream mais curto.
           */
          "-shortest",


          /*
           * Evitar timestamps negativos
           * sem recriar PTS.
           */
          "-avoid_negative_ts",
          "make_zero",


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


      const duracaoVideoBase =
        await obterDuracaoAudio(
          videoBasePath
        );


      console.log(
        "Duração vídeo base:",
        duracaoVideoBase
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
      | Aplicar legendas
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
          "ETAPA 2 - legendas..."
        );


        await executar(
          "ffmpeg",
          [

            "-y",


            /*
             * NÃO usar +genpts aqui.
             */


            "-i",
            videoBasePath,


            /*
             * Reset do relógio,
             * depois aplica legenda.
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
             * Copiar áudio.
             */
            "-c:a",
            "copy",


            "-avoid_negative_ts",
            "make_zero",


            "-movflags",
            "+faststart",


            outputPath,

          ]
        );


      } else {


        console.log(
          "Nenhuma legenda recebida."
        );


        fs.copyFileSync(
          videoBasePath,
          outputPath
        );

      }


      /*
      |--------------------------------------------------------------------------
      | Validar resultado
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


      const duracaoFinal =
        await obterDuracaoAudio(
          outputPath
        );


      console.log(
        "=============================="
      );

      console.log(
        "Vídeo pronto"
      );

      console.log(
        "Tamanho:",
        tamanho,
        "bytes"
      );

      console.log(
        "Duração final:",
        duracaoFinal
      );

      console.log(
        "=============================="
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
