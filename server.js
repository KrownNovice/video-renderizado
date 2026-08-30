function criarLegendaTikTok(palavras, destino) {
  const palavrasPorGrupo = 4;

  const validas = palavras
    .filter(
      item =>
        item &&
        item.palavra &&
        Number.isFinite(Number(item.inicio)) &&
        Number.isFinite(Number(item.fim)) &&
        Number(item.fim) > Number(item.inicio)
    )
    .sort((a, b) => Number(a.inicio) - Number(b.inicio));

  if (validas.length === 0) {
    throw new Error("Nenhuma palavra válida para criar legenda.");
  }

  const cabecalho = `[Script Info]
Title: TikTok Karaoke Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: TikTok,DejaVu Sans,82,&H0000FFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,1,0,1,7,2,5,80,80,0,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;

  const eventos = [];

  for (let i = 0; i < validas.length; i += palavrasPorGrupo) {
    const grupo = validas.slice(i, i + palavrasPorGrupo);

    const inicioGrupo = Number(grupo[0].inicio);
    const fimGrupo = Number(grupo[grupo.length - 1].fim);

    const inicioASS = formatarTempoASS(inicioGrupo);
    const fimASS = formatarTempoASS(fimGrupo);

    let texto = "";

    for (let j = 0; j < grupo.length; j++) {
      const atual = grupo[j];

      const inicioAtual = Number(atual.inicio);

      // Para manter inclusive as pequenas pausas entre palavras,
      // usamos o início da próxima palavra como final desta.
      let fimAtual;

      if (j < grupo.length - 1) {
        fimAtual = Number(grupo[j + 1].inicio);
      } else {
        fimAtual = Number(atual.fim);
      }

      let duracaoCent = Math.round(
        (fimAtual - inicioAtual) * 100
      );

      // Nunca deixa uma palavra com duração zero.
      duracaoCent = Math.max(1, duracaoCent);

      const palavra = escaparTextoASS(
        String(atual.palavra).toUpperCase()
      );

      /*
       * \kf = efeito karaokê.
       * A palavra muda de branco para amarelo
       * exatamente no momento correspondente.
       */
      texto += `{\\kf${duracaoCent}}${palavra}`;

      if (j < grupo.length - 1) {
        texto += " ";
      }
    }

    /*
     * Centraliza na região inferior/média do vídeo,
     * mas longe dos botões do TikTok.
     */
    texto =
      `{\\an5\\pos(540,1320)}` +
      texto;

    eventos.push(
      `Dialogue: 0,${inicioASS},${fimASS},TikTok,,0,0,0,,${texto}`
    );
  }

  fs.writeFileSync(
    destino,
    `${cabecalho}\n${eventos.join("\n")}`,
    "utf8"
  );

  console.log("Legenda TikTok criada.");
  console.log("Palavras:", validas.length);
  console.log("Blocos:", eventos.length);
  console.log(
    "Primeira palavra:",
    validas[0].palavra,
    validas[0].inicio,
    validas[0].fim
  );
}
