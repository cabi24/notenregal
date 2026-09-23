# Notenregal

A self-hosted sheet music library. Point it at a folder of PDFs to browse, read and annotate them in the browser.

![Docker Pulls](https://img.shields.io/docker/pulls/cabi24/notenregal)
![Docker Image Size](https://img.shields.io/docker/image-size/cabi24/notenregal/latest)

## Features

- Read PDFs with zoom, fullscreen, keyboard (arrow keys, space) and swipe page turns
- Convert a PDF to a **Regalpaket**: pages pre-rendered as images for instant page turns, with a two-page spread view
- Annotate Regalpakete with a pen, highlighter, eraser and stamps (fermata, breath mark, accent, staccato, check, X, star, circle)
- Organize music into shelves and favorites; search, sort by name, date or type, and switch between grid and list view
- Upload and rename files from the browser
- Password login

## Quick start

```bash
docker run -d \
  --name notenregal \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /path/to/your/music:/library \
  -v notenregal-data:/data \
  cabi24/notenregal
```

Open `http://localhost:3001` and choose a password. If someone else could reach the port before you do, set `NOTENREGAL_PASSWORD` instead, so the password is in place from the first start.

With Docker Compose:

```yaml
services:
  notenregal:
    image: cabi24/notenregal:latest
    container_name: notenregal
    restart: unless-stopped
    ports:
      - "3001:3001"
    # environment:
    #   - NOTENREGAL_PASSWORD=change-me
    volumes:
      - /path/to/your/music:/library
      - notenregal-data:/data

volumes:
  notenregal-data:
```

An Unraid template is in [`unraid/notenregal.xml`](unraid/notenregal.xml).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `LIBRARY_PATH` | `/library` | Folder containing your PDFs and Regalpakete |
| `DATA_PATH` | `/data` | Folder for the password hash, sessions, shelves, favorites and annotations |
| `NOTENREGAL_PASSWORD` | unset | Initial password, at least 8 characters. Only used while no password exists; after that, change it in the app |

## Usage

**Adding music.** Upload PDFs with **+ Upload PDF**, or copy them into the library folder and reload the page. Only files directly in the folder are listed, not files in subfolders.

**Shelves and favorites.** Create shelves in the sidebar. Right-click a piece to add it to a shelf, rename it, or mark it as a favorite.

**Regalpakete.** Open a PDF and click **Make Regalpaket**. This renders every page at 300 DPI and saves a `.regal` file (a zip of the page images plus the original PDF) next to the PDF. Shelves and favorites switch over to the new file. The original PDF is kept.

**Annotations.** Open a Regalpaket and click ✏ to show the annotation toolbar. Changes save automatically to `annotations.json` in the data folder.

## Development

Requires Node.js 20 or later.

```bash
git clone https://github.com/cabi24/notenregal.git
cd notenregal
npm install
npm install --prefix client
npm run dev
```

This starts the Vite dev server on `http://localhost:3000`, which forwards API requests to the Express server on port 3001. With no environment variables set, the server keeps its data files in the repository root and the library in `./library`.

To build:

```bash
npm run build                    # client only, into client/dist
docker build -t notenregal .     # full image
```

The client is React with Vite, using react-pdf to render PDFs. The server is a single Express app (`server/index.js`) that stores everything in JSON files; there is no database.

## License

MIT
