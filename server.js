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
| Executar FFmpeg / FFprobe
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
| Download
|--------------------------------------------------------------------------
*/

async function baixarArquivo(url, destino) {
  const urlFinal =
    normalizarGoogleDrive(url);

  console.log(
    "Baixando:",
    urlFinal
  );

  const resposta = await axios({
    method: "GET",

    url: urlFinal,

    responseType:
      "arraybuffer",

    maxRedirects: 10,

    timeout: 60000,

    headers: {
      "User-Agent":
        "Mozilla/5.0",
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
| Descobrir duração
|--------------------------------------------------------------------------
*/

function obterDuracao(arquivo) {
  return new Promise(
    (resolve, reject) => {

      const processo =
        spawn(
          "ffprobe",
          [
            "-v",
            "error",

            "-show_entries",
            "format=duration",

            "-of",
            "default=noprint_wrappers=1:nokey=1",

            arquivo,
          ]
        );

      let resultado = "";
      let erro = "";

      processo.stdout.on(
        "data",
        (data) => {
          resultado +=
            data.toString();
        }
      );

      processo.stderr.on(
        "data",
        (data) => {
          erro +=
            data.toString();
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
            Number.isNaN(
              duracao
            )
          ) {

            reject(
              new Error(
                "Não foi possível descobrir a duração."
              )
            );

            return;
          }

          resolve(
            duracao
          );
        }
      );
    }
  );
}


/*
|--------------------------------------------------------------------------
| Extensão
|--------------------------------------------------------------------------
*/

function descobrirExtensao(url) {
  const limpa =
    String(url)
      .split("?")[0]
      .toLowerCase();

  if (
    limpa.endsWith(
      ".png"
    )
  ) {
    return "png";
  }

  if (
    limpa.endsWith(
      ".jpg"
    ) ||
    limpa.endsWith(
      ".jpeg"
    )
  ) {
    return "jpg";
  }

  if (
    limpa.endsWith(
      ".webp"
    )
  ) {
    return "webp";
  }

  return "webp";
}


/*
|--------------------------------------------------------------------------
| Tempo ASS
|--------------------------------------------------------------------------
*/

function formatarTempoASS(
  segundos
) {

  const total =
    Math.max(
      0,
      Math.round(
        Number(
          segundos
        ) * 100
      )
    );

  const horas =
    Math.floor(
      total /
        360000
    );

  const minutos =
    Math.floor(
      (
        total %
        360000
      ) /
        6000
    );

  const segundosInteiros =
    Math.floor(
      (
        total %
        6000
      ) /
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

function escaparTextoASS(
  texto
) {

  return String(
    texto || ""
  )
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
| Detectar valor monetário
|--------------------------------------------------------------------------
*/

function ehNumeroPreco(texto) {

  const valor =
    String(
      texto || ""
    )
      .trim()
      .replace(
        /\s/g,
        ""
      );

  return /^\d{1,6}([.,]\d{1,2})?$/.test(
    valor
  );
}


/*
|--------------------------------------------------------------------------
| Normalizar palavras e preços
|--------------------------------------------------------------------------
|
| Exemplos:
|
| R$ + 39,90
| vira:
| R$ 39,90
|
| R + $ + 39,90
| vira:
| R$ 39,90
|
| R$39,90
| vira:
| R$ 39,90
|
|--------------------------------------------------------------------------
*/

function normalizarPalavras(
  palavras
) {

  const base =
    palavras
      .filter(
        (item) =>
          item &&
          item.palavra &&
          Number.isFinite(
            Number(
              item.inicio
            )
          ) &&
          Number.isFinite(
            Number(
              item.fim
            )
          ) &&
          Number(
            item.fim
          ) >
            Number(
              item.inicio
            )
      )
      .map(
        (item) => ({

          palavra:
            String(
              item.palavra
            ).trim(),

          inicio:
            Number(
              item.inicio
            ),

          fim:
            Number(
              item.fim
            ),

          preco:
            false,

        })
      )
      .sort(
        (a, b) =>
          a.inicio -
          b.inicio
      );


  const resultado =
    [];


  for (
    let i = 0;
    i < base.length;
    i++
  ) {

    const atual =
      base[i];

    const texto =
      atual.palavra
        .replace(
          /\s/g,
          ""
        );


    /*
    |--------------------------------------------------------------------------
    | Caso:
    |
    | R$39,90
    |--------------------------------------------------------------------------
    */

    const precoJunto =
      texto.match(
        /^R\$(\d{1,6}(?:[.,]\d{1,2})?)$/i
      );


    if (
      precoJunto
    ) {

      resultado.push({

        palavra:
          `R$ ${precoJunto[1]}`,

        inicio:
          atual.inicio,

        fim:
          atual.fim,

        preco:
          true,

      });

      continue;
    }


    /*
    |--------------------------------------------------------------------------
    | Caso:
    |
    | R$ + 39,90
    |--------------------------------------------------------------------------
    */

    if (
      /^R\$$/i.test(
        texto
      ) &&
      base[i + 1] &&
      ehNumeroPreco(
        base[i + 1]
          .palavra
      )
    ) {

      resultado.push({

        palavra:
          `R$ ${base[i + 1].palavra}`,

        inicio:
          atual.inicio,

        fim:
          base[i + 1]
            .fim,

        preco:
          true,

      });


      i += 1;

      continue;
    }


    /*
    |--------------------------------------------------------------------------
    | Caso:
    |
    | R + $ + 39,90
    |--------------------------------------------------------------------------
    */

    if (
      /^R$/i.test(
        texto
      ) &&
      base[i + 1] &&
      String(
        base[i + 1]
          .palavra
      ).trim() === "$" &&
      base[i + 2] &&
      ehNumeroPreco(
        base[i + 2]
          .palavra
      )
    ) {

      resultado.push({

        palavra:
          `R$ ${base[i + 2].palavra}`,

        inicio:
          atual.inicio,

        fim:
          base[i + 2]
            .fim,

        preco:
          true,

      });


      i += 2;

      continue;
    }


    /*
    |--------------------------------------------------------------------------
    | Palavra normal
    |--------------------------------------------------------------------------
    */

    resultado.push(
      atual
    );

  }


  return resultado;
}


/*
|--------------------------------------------------------------------------
| Tamanho automático
|--------------------------------------------------------------------------
*/

function calcularFonte(
  grupo
) {

  const texto =
    grupo
      .map(
        item =>
          String(
            item.palavra
          )
      )
      .join(" ");


  const caracteres =
    texto.length;


  /*
   * Grupo contendo preço:
   * usa um pouco menos.
   */

  const temPreco =
    grupo.some(
      item =>
        item.preco
    );


  if (
    temPreco
  ) {

    if (
      caracteres <= 16
    ) {
      return {
        normal: 58,
        destaque: 66,
      };
    }


    if (
      caracteres <= 22
    ) {
      return {
        normal: 52,
        destaque: 60,
      };
    }


    return {
      normal: 46,
      destaque: 54,
    };

  }


  /*
   * Legenda normal
   */

  if (
    caracteres <= 15
  ) {

    return {
      normal: 60,
      destaque: 68,
    };

  }


  if (
    caracteres <= 22
  ) {

    return {
      normal: 56,
      destaque: 64,
    };

  }


  if (
    caracteres <= 29
  ) {

    return {
      normal: 50,
      destaque: 58,
    };

  }


  return {
    normal: 44,
    destaque: 52,
  };
}


/*
|--------------------------------------------------------------------------
| Criar legenda TikTok
|--------------------------------------------------------------------------
*/

function criarLegendaTikTok(
  palavras,
  destino
) {

  const palavrasPorGrupo =
    3;


  /*
   * Aqui o preço é mesclado.
   */
  const validas =
    normalizarPalavras(
      palavras
    );


  if (
    validas.length ===
    0
  ) {

    throw new Error(
      "Nenhuma palavra válida para legenda."
    );

  }


  console.log(
    "Palavras normalizadas:"
  );


  validas.forEach(
    item => {

      if (
        item.preco
      ) {

        console.log(
          "PREÇO DETECTADO:",
          item.palavra
        );

      }

    }
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
Style: TikTok,DejaVu Sans,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H40000000,-1,0,0,0,100,100,0,0,1,5,1,5,110,110,0,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;


  const eventos =
    [];


  /*
  |--------------------------------------------------------------------------
  | Grupos de 3
  |--------------------------------------------------------------------------
  */

  for (
    let grupoInicio =
      0;

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


    const fonte =
      calcularFonte(
        grupo
      );


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


      if (
        indiceGlobal +
          1 <
        validas.length
      ) {

        fimEvento =
          validas[
            indiceGlobal +
              1
          ].inicio;

      } else {

        fimEvento =
          atual.fim;

      }


      if (
        fimEvento <=
        inicioEvento
      ) {

        fimEvento =
          atual.fim;

      }


      /*
      |--------------------------------------------------------------------------
      | Montar grupo
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
                  item
                    .palavra
                    .toUpperCase()
                );


              /*
               * Palavra atual.
               */
              if (
                posicao ===
                j
              ) {

                /*
                 * Se for preço,
                 * deixa ele amarelo inteiro.
                 */
                if (
                  item.preco
                ) {

                  return (
                    "{\\c&H0000FFFF&" +
                    `\\fs${fonte.destaque}` +
                    "\\bord6" +
                    "}" +
                    palavra +
                    "{\\c&H00FFFFFF&" +
                    `\\fs${fonte.normal}` +
                    "\\bord5" +
                    "}"
                  );

                }


                return (
                  "{\\c&H0000FFFF&" +
                  `\\fs${fonte.destaque}` +
                  "\\bord6" +
                  "}" +
                  palavra +
                  "{\\c&H00FFFFFF&" +
                  `\\fs${fonte.normal}` +
                  "\\bord5" +
                  "}"
                );

              }


              return palavra;
            }
          )
          .join(" ");


      /*
      |--------------------------------------------------------------------------
      | Centro
      |--------------------------------------------------------------------------
      */

      const texto =
        "{\\an5" +
        "\\pos(540,1330)" +
        `\\fs${fonte.normal}` +
        "}" +
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
    "Legenda criada."
  );


  console.log(
    "Eventos:",
    eventos.length
  );

}


/*
|--------------------------------------------------------------------------
| Home
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

      modo:
        "placeholder-imagem-loop",

      legenda:
        "tiktok-preco-protegido",

      preco:
        "R$ + valor unidos",

      palavras_por_bloco:
        3,

      fonte:
        "automatica",

      versao:
        "7.2",

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
        palavras =
          [],
      } =
        req.body;


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
        "============================"
      );

      console.log(
        "Render:",
        id
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


      const duracaoAudio =
        await obterDuracao(
          audioPath
        );


      console.log(
        "Duração áudio:",
        duracaoAudio
      );


      /*
      |--------------------------------------------------------------------------
      | Placeholder
      |--------------------------------------------------------------------------
      */

      const imagemUrl =
        imagens[0];


      const extensao =
        descobrirExtensao(
          imagemUrl
        );


      const imagemPath =
        path.join(
          pasta,
          `placeholder.${extensao}`
        );


      await baixarArquivo(
        imagemUrl,
        imagemPath
      );


      /*
      |--------------------------------------------------------------------------
      | Vídeo base
      |--------------------------------------------------------------------------
      */

      const videoBasePath =
        path.join(
          pasta,
          `${id}-base.mp4`
        );


      await executar(
        "ffmpeg",
        [

          "-y",

          "-loop",
          "1",

          "-framerate",
          "24",

          "-i",
          imagemPath,

          "-i",
          audioPath,

          "-vf",

          "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p",

          "-c:v",
          "libx264",

          "-preset",
          "ultrafast",

          "-crf",
          "25",

          "-pix_fmt",
          "yuv420p",

          "-r",
          "24",

          "-threads",
          "2",

          "-c:a",
          "aac",

          "-ar",
          "48000",

          "-b:a",
          "128k",

          "-t",
          String(
            duracaoAudio
          ),

          "-movflags",
          "+faststart",

          videoBasePath,

        ]
      );


      /*
      |--------------------------------------------------------------------------
      | Final
      |--------------------------------------------------------------------------
      */

      const outputPath =
        path.join(
          pasta,
          `${id}.mp4`
        );


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


        await executar(
          "ffmpeg",
          [

            "-y",

            "-i",
            videoBasePath,

            "-vf",

            `setpts=PTS-STARTPTS,subtitles=${legendaPath}`,

            "-c:v",
            "libx264",

            "-preset",
            "veryfast",

            "-crf",
            "23",

            "-pix_fmt",
            "yuv420p",

            "-threads",
            "2",

            "-c:a",
            "copy",

            "-t",
            String(
              duracaoAudio
            ),

            "-movflags",
            "+faststart",

            outputPath,

          ]
        );


      } else {


        fs.copyFileSync(
          videoBasePath,
          outputPath
        );

      }


      if (
        !fs.existsSync(
          outputPath
        )
      ) {

        throw new Error(
          "MP4 final não foi criado."
        );

      }


      const duracaoFinal =
        await obterDuracao(
          outputPath
        );


      const tamanho =
        fs.statSync(
          outputPath
        ).size;


      console.log(
        "Duração final:",
        duracaoFinal
      );


      /*
      |--------------------------------------------------------------------------
      | Retornar
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
