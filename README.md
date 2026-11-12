# CanvasWebViewer

View Obsidian [JSON Canvas](https://jsoncanvas.org/) files from public or private GitHub repositories. [Open CanvasWebViewer](https://cifruktus.github.io/CanvasWebViewer/).

1. Open a `.canvas` file on GitHub and paste its file URL into the viewer. GitHub Raw links also work.
2. For a private repository, open **GitHub token** and save a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with access to the repository and **Contents: Read-only**. Each reader uses their own token.
3. Select **Copy viewer link** to share the canvas. The link contains the GitHub file URL. The viewer saves the token in browser storage and sends it to the GitHub API as an authorization header. Use **GitHub token → Remove saved token** to clear it.

You can also create a viewer link directly. Set the `src` query parameter to the URL-encoded GitHub file URL. A branch URL follows that branch. Use a GitHub permalink to open an exact version. The viewer resolves the revision to one commit before reading the canvas and its images.

## Attachments

Image paths start at the root of the repository, including when the `.canvas` file is in a subfolder. For a vault in a subfolder, set **Attachment paths → Vault folder within the repository** or add a URL-encoded `vaultRoot` query parameter. With `vaultRoot=notes`, `images/cover.png` resolves to `notes/images/cover.png`.

The viewer shows PNG, JPEG, GIF and WebP images, plain-text cards, groups, links and labeled edges. Use a group in the sidebar to focus it, drag to move, scroll or pinch to zoom, and double-click an image to view it at its original size. Unavailable attachments are marked on the canvas.

## Development

Run `npm test` with Node.js 22 or later. To preview locally, run `python3 -m http.server --directory docs` and open [localhost:8000](http://localhost:8000). GitHub Pages serves the `docs` folder on `main`.
