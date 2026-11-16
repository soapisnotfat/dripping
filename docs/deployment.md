# Static deployment

[Back to the project](../README.md) · [Development](development.md) · [PDF runtime](pdf-import.md)

Dripping builds to a static site and can run on GitHub Pages, Cloudflare Pages, or another HTTPS static host.

## GitHub Pages

The repository includes a [deployment workflow](../.github/workflows/deploy-pages.yml).

1. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Merge a pull request into `main` or push an update to `main`. To deploy manually, open **Actions → Deploy to GitHub Pages → Run workflow** and select `main`.
3. Wait for the workflow to finish, then open the published URL shown in **Settings → Pages**.

Updates to `main` automatically run the deployment workflow: tests must pass and the production build must succeed before Pages deploys. Pull requests and other branches run the separate **Check** workflow. The manual deployment entry point remains available.

To use a custom domain, add it in GitHub's Pages settings before configuring DNS. For a subdomain, create a CNAME pointing to the repository owner's `<username>.github.io` hostname, without a repository path. If Cloudflare manages your DNS, use **DNS only** when GitHub serves the site directly. Enable **Enforce HTTPS** in GitHub once its certificate is ready. See [GitHub's custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## Cloudflare Pages

Connect your GitHub repository in **Workers & Pages → Create application → Pages → Connect to Git**, then use these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank |
| Environment variable | `NODE_VERSION=22` |

With Git integration enabled, pushes to the production branch trigger a new deployment. Add a custom domain through the Pages project's **Custom domains** settings. See the [Cloudflare Pages setup guide](https://developers.cloudflare.com/pages/get-started/git-integration/).

## Other static hosts

```sh
npm ci
npm run build
npm run preview
```

The preview command serves the production build locally. Publish the entire `dist/` directory to your host; opening its `index.html` directly as a file is not supported. Relative asset paths allow deployment under a path such as `/dripping/`.

The build includes a service worker for offline use and an `_headers` file for compatible hosts. On other hosts, configure `index.html` and `sw.js` to revalidate on each request, while allowing hashed assets to cache. When an update is available, the app prompts for a reload rather than interrupting a recording.

The build needs network access when pinned recognition models or runtime files are missing from `.cache/sheetscan/`. This is build-time preparation. The deployed app serves these files from its own origin and performs recognition in the browser; it does not need an application server or inference service. See [PDF import](pdf-import.md) for the pin and cache layout.
