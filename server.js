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
| Duração do áudio
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
| Extensão das imagens
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
| Escapar caracteres da legenda
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
| 4 palavras ficam na tela.
|
| Exemplo:
|
| CANSADO DA BAGUNÇA NA
|
| Conforme a fala:
|
| CANSADO = amarelo
| DA      = amarelo
| BAGUNÇA = amarelo
|
| Cada evento usa diretamente
| os timestamps reais do Whisper.
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
    "Última palavra:",
    validas[
      validas.length - 1
    ]
  );

  console.log(
    "Total palavras:",
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
  | Criar grupos
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
    | Cada palavra gera um evento
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


      /*
      |--------------------------------------------------------------------------
      | Início REAL da palavra
      |--------------------------------------------------------------------------
      */

      const inicioEvento =
        atual.inicio;


      /*
      |--------------------------------------------------------------------------
      | Final
      |--------------------------------------------------------------------------
      |
      | Mantemos o texto até a próxima palavra começar.
      |
      */

      let fimEvento;

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
      |--------------------------------------------------------------------------
      | Segurança
      |--------------------------------------------------------------------------
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
               * Palavra sendo falada
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
               * Outras palavras
               */
              return palavra;
            }
          )
          .join(" ");


      /*
      |--------------------------------------------------------------------------
      | Posição da legenda
      |--------------------------------------------------------------------------
      |
      | X = 540
      | Y = 1320
      |
      | Centro inferior,
      | mas acima dos controles do TikTok.
      |
      */

      const texto =
        "{\\an5\\pos(540,1320)}" +
        textoGrupo;


      /*
      |--------------------------------------------------------------------------
      | Criar evento
      |--------------------------------------------------------------------------
      */

      const evento =
        `Dialogue: 0,${formatarTempoASS(
          inicioEvento
        )},${formatarTempoASS(
          fimEvento
        )},TikTok,,0,0,0,,${texto}`;


      eventos.push(
        evento
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | Salvar arquivo
  |--------------------------------------------------------------------------
  */

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
    "Total eventos:",
    eventos.length
  );

  console.log(
    "Primeiro evento:",
    eventos[0]
  );
}


/*
|--------------------------------------------------------------------------
| Página inicial
|--------------------------------------------------------------------------
*/

app.get(
  "/",
  (req, res) => {

    res.json({
      status:
        "online",

      servico:
        "video-renderizado",

      ffmpeg:
        true,

      legenda:
        "timestamps-reais-eventos",

      versao:
        "5.0",
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
  (req, res) => {

    res.json({
      ok: true,
    });
  }
);


/*
|--------------------------------------------------------------------------
| Renderizar
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
        "ID:",
        id
      );

      console.log(
        "Imagens:",
        imagens.length
      );

      console.log(
        "Palavras recebidas:",
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
      | Duração áudio
      |--------------------------------------------------------------------------
      */

      const duracaoAudio =
        await obterDuracaoAudio(
          audioPath
        );


      console.log(
        "Duração áudio:",
        duracaoAudio
      );


      /*
      |--------------------------------------------------------------------------
      | Tempo por imagem
      |--------------------------------------------------------------------------
      */

      const duracaoImagem =
        duracaoAudio /
        imagensLocais.length;


      /*
      |--------------------------------------------------------------------------
      | Criar concat
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
      | Criar vídeo base
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
          "Aplicando legendas..."
        );


        await executar(
          "ffmpeg",
          [

            "-y",

            "-i",
            videoBasePath,

            "-vf",

            `subtitles=${legendaPath}`,

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
      | Validar
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


      /*
      |--------------------------------------------------------------------------
      | Retornar vídeo
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
