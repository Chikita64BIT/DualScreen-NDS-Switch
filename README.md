# DualScreen — Nintendo DS no Nintendo Switch

Jogue Nintendo DS no navegador do **Nintendo Switch sem modificação**. O PC roda o emulador [melonDS](https://melonds.kuribo64.net/) e transmite as duas telas pelo Wi-Fi. O Switch mostra a imagem e devolve os botões dos Joy-Con e o toque na tela.

O navegador do Switch não tem WebAssembly, porque a Nintendo desativa o JIT, e por isso não consegue emular nada sozinho. O DualScreen segue a ideia do [switch-gba](https://github.com/itsbjoern/switch-gba): o trabalho pesado fica no PC.

> **Guia passo a passo:** [INSTALACAO.md](INSTALACAO.md)

## Arquitetura

```text
+------------------------------------------------------------------------+
|                        PC  (Windows + Node.js)                         |
|                                                                        |
|  +----------------+        +----------------------------------------+  |
|  |  roms/  *.nds  |------->|  Núcleo melonDS (WebAssembly no Node)  |  |
|  |  saves/ *.sav  |<-------|  src/stream-session.js   ~60 FPS       |  |
|  +----------------+        +-------------------+--------------------+  |
|                                                |          ^            |
|                          framebuffer 256x384   |          |  teclas,   |
|                          RGBA                  v          |  toque     |
|                            +-------------------+----------+---------+  |
|                            |  sharp: JPEG (~32 KB por quadro)       |  |
|                            |  src/server.js: HTTP + WebSocket :8888 |  |
|                            +-------------------+----------^---------+  |
+------------------------------------------------|----------|------------+
                                                 |          |
                     JPEG binário (WebSocket)    |          |  JSON: botões,
                     1 quadro por confirmação    v          |  toque, turbo
+------------------------------------------------|----------|------------+
|                   NINTENDO SWITCH / SWITCH LITE (sem modificação)      |
|                                                                        |
|  +------------------------------------------------------------------+  |
|  |  Navegador WebKit oculto (aberto pelo teste de DNS)              |  |
|  |  stream.html + src/stream.js                                     |  |
|  |   - Imagem: JPEG -> Image -> 2 x <canvas> 256x192                |  |
|  |   - Gamepad API: Joy-Con lidos a cada 16 ms (ZL turbo, ZR menu)  |  |
|  |   - Toque: tela inferior vira a stylus do DS                     |  |
|  +------------------------------------------------------------------+  |
+------------------------------------------------------------------------+
```

## Recursos

- Biblioteca de jogos no navegador, agrupada por idioma (`roms/portugues-br`, `roms/ingles`, `roms/multilingue`).
- Streaming para o Switch: as duas telas a ~60 FPS, em JPEG por WebSocket, com controle de fluxo para o atraso não se acumular.
- Joy-Con pela Gamepad API, toque na tela inferior do DS, Start e Select como botões de toque, teclado e gamepad no PC.
- Turbo segurando o ZL. Menu no ZR ou no botão B.
- Saves automáticos e 3 slots de estado salvo, guardados no PC em `saves/`.
- Telas empilhadas ou lado a lado, três níveis de qualidade de imagem e mapeamento de botões configurável.
- Em um PC com navegador moderno, também dá para jogar localmente, com som ("Jogar neste navegador").

## Início rápido (Windows)

1. Instale o [Node.js](https://nodejs.org) LTS (versão 20.11 ou mais nova).
2. Coloque suas ROMs `.nds` nas pastas de `roms/`.
3. Dê dois cliques em `start.bat`.
4. No Switch, abra o navegador e acesse o endereço mostrado no terminal, por exemplo `http://IP_DO_PC:8888`.

Em Linux ou macOS: `npm install` e depois `npm start`.

Configurações por variável de ambiente: `PORT` (padrão `8888`) e `HOST` (padrão `0.0.0.0`; use `127.0.0.1` para aceitar só o próprio PC).

## Controles no Switch

| Switch | Nintendo DS |
|---|---|
| A, B, Y | A, B, Y |
| X na tela | X (o X físico pode abrir a saída do navegador) |
| L, R | L, R |
| + / − | Start / Select |
| D-pad ou analógico esquerdo | Direcional |
| Toque na tela inferior | Stylus |
| ZL (segurar) | Turbo, até 3x mais rápido |
| ZR | Menu |

Se algum botão não responder, use **Menu → Configurar botões**.

No navegador interno do Switch, o **X físico** pode abrir a confirmação para sair. É um comando do próprio navegador. Para usar o X do jogo sem essa janela, toque no botão **X** ao lado da tela do DS. O menu também oferece remapeamento para outro botão do controle.

## Limitações

- **Sem som no Switch:** o navegador do console não oferece uma API de áudio utilizável.
- **Uma partida por vez:** abrir outro jogo troca o que está rodando no PC. Sem nenhum aparelho conectado, a emulação pausa.
- **Desempenho depende do PC:** o núcleo é interpretado (sem JIT). Em fases com muito 3D, um PC comum fica perto do limite de 60 FPS, e o turbo rende menos.
- **Sem senha:** qualquer aparelho da rede local que alcance a porta pode abrir a biblioteca. Não exponha a porta na internet.

## Estrutura

| Caminho | Função |
|---|---|
| `src/server.js` | Servidor HTTP, lista de ROMs e WebSocket `/ws` |
| `src/stream-session.js` | Roda o núcleo melonDS no Node, codifica os quadros, saves e estados |
| `stream.html`, `src/stream.js`, `src/stream.css` | Página de streaming usada no Switch |
| `index.html`, `src/library.js`, `src/library.css` | Biblioteca de jogos |
| `player.html`, `src/app.js`, `src/styles.css`, `src/audio-worklet.js` | Emulador local no navegador (Pilas-melonDS) |
| `pilas-melonds-core.js`, `pilas-melonds-core.wasm` | Núcleo melonDS compilado para WebAssembly |
| `roms/` | Seus jogos (fora do Git) |
| `saves/` | Saves e estados salvos (fora do Git) |

## Créditos e licença

- Núcleo e emulador de navegador: [Pilas-melonDS](https://github.com/josepilas/pilas-melonds), baseado no [melonDS](https://github.com/melonDS-emu/melonDS). A documentação original está em [PILAS-MELONDS-UPSTREAM.md](PILAS-MELONDS-UPSTREAM.md).
- Ideia do streaming para o Switch: [switch-gba](https://github.com/itsbjoern/switch-gba).
- Licença: o código deste repositório segue a MPL-2.0 herdada do Pilas-melonDS, veja [LICENSE](LICENSE). O núcleo melonDS, que vai compilado em `pilas-melonds-core.wasm`, é publicado pelo projeto melonDS sob a GPL-3.0. Confira essas obrigações antes de redistribuir.

Este projeto não distribui jogos, BIOS, firmware nem arquivos de sistema. Use somente ROMs que você tenha direito de utilizar. Nintendo DS e Nintendo Switch são marcas da Nintendo; este projeto não tem relação com a Nintendo.
