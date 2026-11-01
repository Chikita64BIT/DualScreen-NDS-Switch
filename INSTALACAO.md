# Guia de instalação

Este guia leva do zero até um jogo de Nintendo DS rodando no Switch. Leva uns 10 minutos.

## Do que você precisa

| Item | Detalhes |
|---|---|
| PC com Windows 10 ou 11 | É ele que roda o emulador. Funciona também em Linux e macOS, pelo terminal. |
| Node.js 20.11 ou mais novo | Baixe a versão **LTS** em [nodejs.org](https://nodejs.org). |
| Nintendo Switch ou Switch Lite | Sem desbloqueio nem modificação. |
| Mesma rede Wi-Fi | O PC e o Switch precisam estar na mesma rede. O PC pode usar cabo. |
| ROMs de Nintendo DS | Arquivos `.nds` dos seus próprios jogos. Não vêm com o projeto. |

## 1. Baixar o projeto

Escolha uma das opções:

- **ZIP:** no GitHub, clique em **Code → Download ZIP** e extraia a pasta onde quiser, por exemplo `Documentos\DualScreen`.
- **Git:**

  ```bash
  git clone <endereço-do-repositório> DualScreen
  ```

## 2. Instalar o Node.js

1. Baixe o instalador **LTS** em [nodejs.org](https://nodejs.org).
2. Instale com as opções padrão.
3. Para conferir, abra o **Prompt de Comando** e digite:

   ```bash
   node -v
   ```

   Deve aparecer `v20.11.0` ou um número maior.

## 3. Colocar os jogos

Copie os arquivos `.nds` para as pastas dentro de `roms/`:

```text
roms/
├── portugues-br/   jogos ou traduções em português
├── ingles/         versões em inglês
└── multilingue/    jogos com vários idiomas
```

- Se o jogo estiver em `.zip` ou `.7z`, **extraia antes**. O servidor só reconhece `.nds`, `.dsi` e `.srl`.
- Se as pastas não existirem, elas aparecem na primeira vez que você roda o `start.bat`.
- Arquivos colocados direto em `roms/` aparecem como "Sem categoria".

## 4. Iniciar o servidor no PC

1. Dê dois cliques em **`start.bat`**.
2. Na primeira vez, ele instala as dependências (`ws` e `sharp`). Isso precisa de internet e leva menos de um minuto.
3. Se o **Firewall do Windows** perguntar, marque **Redes privadas** e clique em **Permitir acesso**. Sem isso, o Switch não consegue conectar.
4. O terminal mostra o endereço para usar no Switch:

   ```text
   DualScreen está pronto:
     http://SeuIP:8888
   ```

5. A biblioteca também abre no navegador do PC. Deixe a janela do terminal aberta enquanto joga.

> **Linux ou macOS:** na pasta do projeto, rode `npm install` e depois `npm start`.

## 5. Abrir o navegador no Switch

O Switch tem um navegador escondido, que o console abre quando a rede pede um login. Para chegar a ele, use um DNS público que faz essa página aparecer. O mais conhecido é o **SwitchBru**:

1. No Switch, vá em **Configurações do sistema → Internet → Configurações de Internet**.
2. Escolha a sua rede Wi-Fi e depois **Alterar configurações**.
3. Em **Configurações de DNS**, escolha **Manual**.
4. Em **DNS primário**, digite `045.055.142.122` e salve.
5. Escolha **Conectar a esta rede**. O Switch avisa que é preciso se registrar na rede. Toque em **Seguinte**.
6. A página do SwitchBru abre. No campo de endereço, digite o IP que apareceu no terminal do PC, por exemplo `http://IP_DO_PC:8888`.

Avisos sobre esse método:

- Ele **não é oficial** da Nintendo. Enquanto o DNS manual estiver ativo, o console consulta os endereços por esse servidor de terceiros.
- Algumas versões do sistema fecham o navegador depois de um tempo, em torno de 20 minutos. Se acontecer, repita o passo 5. O jogo continua de onde parou, porque ele roda no PC.
- Para voltar ao normal, mude o DNS para **Automático** na mesma tela.

## 6. Jogar

1. Na biblioteca, toque em **Jogar no Switch · streaming** no jogo que quiser.
2. Aperte qualquer botão do Joy-Con para o navegador reconhecer o controle.

| Switch | Nintendo DS |
|---|---|
| A, B, Y | A, B, Y |
| X na tela | X (o X físico pode abrir a saída do navegador) |
| L, R | L, R |
| + / − | Start / Select |
| D-pad ou analógico esquerdo | Direcional |
| Toque na tela inferior | Stylus |
| ZL (segurar) | Turbo |
| ZR | Menu |

Se o **X físico** abrir a confirmação de saída do navegador do Switch, use o botão **X** na tela, ao lado do START. Essa confirmação pertence ao navegador do console.

No **menu** você encontra:

- Pausar e reiniciar.
- Salvar e carregar estados, em 3 slots.
- Telas empilhadas ou lado a lado.
- Qualidade da imagem: baixa, média ou alta.
- Configurar botões e voltar aos botões padrão.
- Sair para a biblioteca.

O progresso do jogo é salvo sozinho em `saves/`, no PC.

## Solução de problemas

| Problema | O que fazer |
|---|---|
| O Switch não abre a página | Confira se o PC e o Switch estão na mesma rede e se o terminal ainda está aberto. Libere o Node.js no Firewall do Windows (Painel de Controle → Firewall → Permitir um aplicativo → Node.js, em **Privada**). |
| O IP mudou | O roteador pode trocar o IP do PC. Veja o endereço novo no terminal. Para fixar o IP, reserve um endereço para o PC nas configurações do roteador. |
| "Este navegador não suporta WebAssembly" | Você abriu "Jogar neste navegador". No Switch, use **Jogar no Switch · streaming**. |
| A imagem trava ou atrasa | No menu, use **Qualidade: baixa**. Prefira Wi-Fi de 5 GHz perto do roteador, ou ligue o PC por cabo. |
| O jogo fica lento em algumas fases | O PC está no limite. Feche programas pesados e deixe o Windows no modo de energia "Melhor desempenho". |
| Um botão não funciona | Menu → **Configurar botões**, e aperte cada botão quando pedir. |
| Não tem som | É uma limitação do navegador do Switch. No PC, "Jogar neste navegador" tem som. |
| `start.bat` diz que o Node.js não foi encontrado | Instale o Node.js LTS, feche e abra o `start.bat` de novo. |
| Falha ao instalar as dependências | Verifique a internet. Depois apague a pasta `node_modules`, se ela existir, e rode o `start.bat` de novo. |

## Segurança

- O servidor não tem senha. Qualquer aparelho da sua rede local consegue abrir a biblioteca.
- **Não** encaminhe a porta `8888` no roteador nem exponha o servidor na internet.
- Para usar outra porta, rode `set PORT=9000` antes de iniciar o servidor (Windows) ou `PORT=9000 npm start` (Linux e macOS).
