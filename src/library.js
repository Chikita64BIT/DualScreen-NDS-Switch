const gameList = document.querySelector("#gameList");
const libraryStatus = document.querySelector("#libraryStatus");
const emptyState = document.querySelector("#emptyState");
const refreshButton = document.querySelector("#refreshButton");

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Tamanho desconhecido";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

const supportsWasm = typeof WebAssembly === "object";

function createPlayLink(href, text, label) {
  const link = document.createElement("a");
  link.className = "play-link";
  link.href = href;
  link.setAttribute("aria-label", label);
  link.append(document.createTextNode(text));
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "↗";
  link.append(arrow);
  return link;
}

function createGameCard(game) {
  const card = document.createElement("article");
  card.className = "game-card";

  const top = document.createElement("div");
  top.className = "game-topline";
  const format = document.createElement("span");
  format.className = "game-format";
  format.textContent = game.extension.toUpperCase().replace(".", "");
  const size = document.createElement("span");
  size.className = "game-size";
  size.textContent = formatSize(game.size);
  top.append(format, size);

  const name = document.createElement("h3");
  name.className = "game-name";
  name.textContent = game.name;

  // The Switch browser has no WebAssembly, so there the PC runs the game and streams it.
  const romPath = `/roms/${game.relativePath.split("/").map(encodeURIComponent).join("/")}`;
  const streamLink = createPlayLink(
    `/stream.html?${new URLSearchParams({ rom: game.relativePath }).toString()}`,
    "Jogar no Switch · streaming",
    `Jogar ${game.name} por streaming`,
  );
  const browserLink = createPlayLink(
    `/player.html?${new URLSearchParams({ rom: romPath }).toString()}`,
    "Jogar neste navegador",
    `Jogar ${game.name} neste navegador`,
  );
  const links = document.createElement("div");
  links.className = "play-links";
  if (supportsWasm) links.append(browserLink, streamLink);
  else links.append(streamLink);

  card.append(top, name, links);
  return card;
}

async function loadLibrary() {
  refreshButton.disabled = true;
  libraryStatus.textContent = "Procurando jogos…";
  emptyState.hidden = true;
  gameList.replaceChildren();

  try {
    const response = await fetch("/api/roms", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const games = await response.json();
    if (!Array.isArray(games)) throw new Error("Resposta inválida do servidor");

    if (games.length === 0) {
      libraryStatus.textContent = "0 jogos encontrados";
      emptyState.hidden = false;
      return;
    }

    const groups = new Map();
    for (const game of games) {
      if (!groups.has(game.language)) groups.set(game.language, { label: game.languageLabel, games: [] });
      groups.get(game.language).games.push(game);
    }

    const priority = ["portugues-br", "ingles", "multilingue", "sem-categoria"];
    const sortedGroups = [...groups.entries()].sort(([a], [b]) => {
      const aOrder = priority.indexOf(a);
      const bOrder = priority.indexOf(b);
      if (aOrder !== -1 || bOrder !== -1) return (aOrder === -1 ? priority.length : aOrder) - (bOrder === -1 ? priority.length : bOrder);
      return a.localeCompare(b, "pt-BR");
    });

    for (const [, group] of sortedGroups) {
      const section = document.createElement("section");
      section.className = "language-group";
      const heading = document.createElement("div");
      heading.className = "language-heading";
      const title = document.createElement("h3");
      title.textContent = group.label;
      const count = document.createElement("span");
      count.textContent = `${group.games.length} ${group.games.length === 1 ? "jogo" : "jogos"}`;
      heading.append(title, count);

      const grid = document.createElement("div");
      grid.className = "game-grid";
      group.games.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
      for (const game of group.games) grid.append(createGameCard(game));
      section.append(heading, grid);
      gameList.append(section);
    }
    libraryStatus.textContent = `${games.length} ${games.length === 1 ? "jogo encontrado" : "jogos encontrados"} · ${groups.size} ${groups.size === 1 ? "idioma" : "grupos de idioma"}`;
  } catch (error) {
    libraryStatus.textContent = "Não foi possível carregar a biblioteca.";
    console.error("Falha ao carregar a biblioteca de ROMs:", error);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadLibrary);

if (location.protocol === "file:") {
  refreshButton.disabled = true;
  libraryStatus.textContent = "Abra o projeto pelo servidor local.";
  emptyState.hidden = false;
  emptyState.querySelector("h3").textContent = "Inicie pelo start.bat";
  emptyState.querySelector("p").textContent =
    "Volte à pasta do projeto e execute start.bat. O navegador abrirá a biblioteca no endereço correto.";
} else {
  loadLibrary();
}
