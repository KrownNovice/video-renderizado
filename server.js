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
}


/*
|--------------------------------------------------------------------------
| Duração
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
| Tempo ASS
|--------------------------------------------------------------------------
*/

function formatarTempoASS(segundos) {
  const total =
    Math.max(
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
| Escapar ASS
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
| Normalizar texto
|--------------------------------------------------------------------------
*/

function normalizarTexto(texto) {
  return String(
    texto || ""
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /^[.,;:!?]+|[.,;:!?]+$/g,
      ""
    )
    .trim();
}


/*
|--------------------------------------------------------------------------
| Números escritos em português
|--------------------------------------------------------------------------
*/

const unidades = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezasseis: 16,
  dezessete: 17,
  dezassete: 17,
  dezoito: 18,
  dezenove: 19,
};

const dezenas = {
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
};

const centenas = {
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
};


/*
|--------------------------------------------------------------------------
| Converter palavras para número
|--------------------------------------------------------------------------
*/

function palavrasParaNumero(tokens) {
  if (
    !tokens ||
    tokens.length === 0
  ) {
    return null;
  }

  let total = 0;
  let atual = 0;
  let encontrou = false;

  for (
    const tokenOriginal
    of tokens
  ) {

    const token =
      normalizarTexto(
        tokenOriginal
      );

    if (
      token === "e"
    ) {
      continue;
    }


    /*
     * Número já veio em algarismo.
     */
    if (
      /^\d+$/.test(
        token
      )
    ) {

      atual +=
        Number(token);

      encontrou =
        true;

      continue;
    }


    if (
      Object.prototype
        .hasOwnProperty.call(
          unidades,
          token
        )
    ) {

      atual +=
        unidades[token];

      encontrou =
        true;

      continue;
    }


    if (
      Object.prototype
        .hasOwnProperty.call(
          dezenas,
          token
        )
    ) {

      atual +=
        dezenas[token];

      encontrou =
        true;

      continue;
    }


    if (
      Object.prototype
        .hasOwnProperty.call(
          centenas,
          token
        )
    ) {

      atual +=
        centenas[token];

      encontrou =
        true;

      continue;
    }


    if (
      token === "mil"
    ) {

      if (
        atual === 0
      ) {
        atual = 1;
      }

      total +=
        atual * 1000;

      atual = 0;

      encontrou =
        true;

      continue;
    }


    return null;
  }


  if (
    !encontrou
  ) {
    return null;
  }


  return total + atual;
}


/*
|--------------------------------------------------------------------------
| É parte de número falado?
|--------------------------------------------------------------------------
*/

function ehParteNumero(texto) {
  const token =
    normalizarTexto(
      texto
    );

  if (
    token === "e"
  ) {
    return true;
  }

  if (
    /^\d+$/.test(
      token
    )
  ) {
    return true;
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        unidades,
        token
      )
  ) {
    return true;
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        dezenas,
        token
      )
  ) {
    return true;
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        centenas,
        token
      )
  ) {
    return true;
  }

  if (
    token === "mil"
  ) {
    return true;
  }

  return false;
}


/*
|--------------------------------------------------------------------------
| Formatar preço
|--------------------------------------------------------------------------
*/

function formatarPreco(
  reais,
  centavos = 0
) {

  const valorReais =
    Math.max(
      0,
      Number(reais) || 0
    );

  const valorCentavos =
    Math.max(
      0,
      Number(centavos) || 0
    );


  return (
    "R$ " +
    valorReais +
    "," +
    String(
      valorCentavos
    ).padStart(
      2,
      "0"
    )
  );
}


/*
|--------------------------------------------------------------------------
| Detectar preço já numérico
|--------------------------------------------------------------------------
*/

function tentarPrecoNumerico(
  base,
  indice
) {

  const atual =
    base[indice];

  const compacto =
    String(
      atual.palavra
    )
      .replace(
        /\s/g,
        ""
      );


  /*
   * R$39,90
   */
  const junto =
    compacto.match(
      /^R\$(\d{1,6})(?:[.,](\d{1,2}))?$/i
    );


  if (
    junto
  ) {

    return {

      item: {
        palavra:
          formatarPreco(
            junto[1],
            junto[2] || 0
          ),

        inicio:
          atual.inicio,

        fim:
          atual.fim,

        preco:
          true,
      },

      ultimoIndice:
        indice,

    };

  }


  /*
   * R$
   * ou
   * R + $
   */
  let cursor =
    indice;


  if (
    /^R\$$/i.test(
      compacto
    )
  ) {

    cursor =
      indice + 1;

  } else if (
    /^R$/i.test(
      compacto
    ) &&
    base[
      indice + 1
    ] &&
    String(
      base[
        indice + 1
      ].palavra
    ).trim() === "$"
  ) {

    cursor =
      indice + 2;

  } else {

    return null;

  }


  if (
    !base[cursor]
  ) {
    return null;
  }


  const primeiro =
    String(
      base[cursor]
        .palavra
    )
      .trim()
      .replace(
        /\s/g,
        ""
      );


  /*
   * 39,90
   */
  const valorCompleto =
    primeiro.match(
      /^(\d{1,6})[.,](\d{1,2})$/
    );


  if (
    valorCompleto
  ) {

    return {

      item: {
        palavra:
          formatarPreco(
            valorCompleto[1],
            valorCompleto[2]
          ),

        inicio:
          atual.inicio,

        fim:
          base[cursor].fim,

        preco:
          true,
      },

      ultimoIndice:
        cursor,

    };

  }


  /*
   * 39 + 90
   *
   * Whisper às vezes separa
   * reais e centavos.
   */
  if (
    /^\d{1,6}$/.test(
      primeiro
    )
  ) {

    const reais =
      Number(
        primeiro
      );

    let centavos =
      0;

    let ultimo =
      cursor;


    const proximo =
      base[
        cursor + 1
      ];


    if (
      proximo
    ) {

      const textoProximo =
        String(
          proximo.palavra
        )
          .trim()
          .replace(
            /^[,.]/,
            ""
          );


      /*
       * R$ 39 90
       */
      if (
        /^\d{1,2}$/.test(
          textoProximo
        ) &&
        Number(
          textoProximo
        ) <= 99
      ) {

        centavos =
          Number(
            textoProximo
          );

        ultimo =
          cursor + 1;
      }

    }


    return {

      item: {
        palavra:
          formatarPreco(
            reais,
            centavos
          ),

        inicio:
          atual.inicio,

        fim:
          base[ultimo].fim,

        preco:
          true,
      },

      ultimoIndice:
        ultimo,

    };

  }


  return null;
}


/*
|--------------------------------------------------------------------------
| Detectar:
|
| trinta e nove reais
| trinta e nove reais e noventa centavos
| 39 reais e 90 centavos
|--------------------------------------------------------------------------
*/

function tentarPrecoFalado(
  base,
  indice
) {

  if (
    !base[indice] ||
    !ehParteNumero(
      base[indice]
        .palavra
    )
  ) {
    return null;
  }


  const palavrasReais =
    [];

  let cursor =
    indice;

  let encontrouReais =
    false;


  /*
   * Procurar "real/reais".
   */
  while (
    cursor <
      base.length &&
    cursor <
      indice + 10
  ) {

    const token =
      normalizarTexto(
        base[cursor]
          .palavra
      );


    if (
      token === "real" ||
      token === "reais"
    ) {

      encontrouReais =
        true;

      break;
    }


    if (
      !ehParteNumero(
        token
      )
    ) {
      return null;
    }


    palavrasReais.push(
      token
    );


    cursor++;
  }


  if (
    !encontrouReais
  ) {
    return null;
  }


  const reais =
    palavrasParaNumero(
      palavrasReais
    );


  if (
    reais === null
  ) {
    return null;
  }


  const indiceReais =
    cursor;

  cursor++;


  /*
   * Depois de "reais"
   * pode vir:
   *
   * e noventa centavos
   */
  if (
    base[cursor] &&
    normalizarTexto(
      base[cursor]
        .palavra
    ) === "e"
  ) {
    cursor++;
  }


  const inicioCentavos =
    cursor;

  const palavrasCentavos =
    [];

  let encontrouCentavos =
    false;


  while (
    cursor <
      base.length &&
    cursor <
      inicioCentavos + 8
  ) {

    const token =
      normalizarTexto(
        base[cursor]
          .palavra
      );


    if (
      token === "centavo" ||
      token === "centavos"
    ) {

      encontrouCentavos =
        true;

      break;
    }


    if (
      !ehParteNumero(
        token
      )
    ) {
      break;
    }


    palavrasCentavos.push(
      token
    );


    cursor++;
  }


  let centavos =
    0;

  let ultimoIndice =
    indiceReais;


  if (
    encontrouCentavos &&
    palavrasCentavos.length >
      0
  ) {

    const valorCentavos =
      palavrasParaNumero(
        palavrasCentavos
      );


    if (
      valorCentavos !==
        null
    ) {

      centavos =
        Math.min(
          99,
          valorCentavos
        );

      ultimoIndice =
        cursor;
    }

  }


  return {

    item: {

      palavra:
        formatarPreco(
          reais,
          centavos
        ),

      inicio:
        base[indice]
          .inicio,

      fim:
        base[
          ultimoIndice
        ].fim,

      preco:
        true,

    },

    ultimoIndice,

  };
}


/*
|--------------------------------------------------------------------------
| Normalizar palavras
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

    /*
     * Primeiro:
     * preço com R$.
     */
    const numerico =
      tentarPrecoNumerico(
        base,
        i
      );


    if (
      numerico
    ) {

      resultado.push(
        numerico.item
      );

      console.log(
        "PREÇO NUMÉRICO:",
        numerico.item
          .palavra
      );


      i =
        numerico
          .ultimoIndice;

      continue;
    }


    /*
     * Segundo:
     * preço falado.
     */
    const falado =
      tentarPrecoFalado(
        base,
        i
      );


    if (
      falado
    ) {

      resultado.push(
        falado.item
      );


      console.log(
        "PREÇO FALADO:",
        falado.item
          .palavra
      );


      i =
        falado
          .ultimoIndice;

      continue;
    }


    /*
     * Palavra comum.
     */
    resultado.push(
      base[i]
    );

  }


  return resultado;
}


/*
|--------------------------------------------------------------------------
| Fonte
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


  const tamanho =
    texto.length;


  const temPreco =
    grupo.some(
      item =>
        item.preco
    );


  /*
   * Com preço:
   * mais conservador.
   */
  if (
    temPreco
  ) {

    if (
      tamanho <= 15
    ) {
      return {
        normal: 54,
        destaque: 62,
      };
    }


    if (
      tamanho <= 22
    ) {
      return {
        normal: 48,
        destaque: 56,
      };
    }


    return {
      normal: 42,
      destaque: 50,
    };

  }


  /*
   * Normal.
   */
  if (
    tamanho <= 15
  ) {
    return {
      normal: 60,
      destaque: 68,
    };
  }


  if (
    tamanho <= 22
  ) {
    return {
      normal: 56,
      destaque: 64,
    };
  }


  if (
    tamanho <= 29
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
| Criar legenda
|--------------------------------------------------------------------------
*/

function criarLegendaTikTok(
  palavras,
  destino
) {

  const palavrasPorGrupo =
    3;


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
    "Legenda normalizada:"
  );


  console.log(
    validas.map(
      item =>
        item.palavra
    )
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


      if (
        fimEvento <=
        inicioEvento
      ) {

        fimEvento =
          atual.fim;

      }


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


              if (
                posicao === j
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


              return palavra;
            }
          )
          .join(" ");


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
        "tiktok-preco-inteligente",

      preco:
        "numerico-ou-falado",

      palavras_por_bloco:
        3,

      versao:
        "7.3",

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
        "Duração:",
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
