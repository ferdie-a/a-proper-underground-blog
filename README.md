# a proper underground blog

A plain-text blog you write from your phone, with no platform, no database and no dependencies.

- Every piece is a plain text file in your own GitHub repository.
- The editor at `/write` keeps working without a network and saves to GitHub through a small server function that holds the token.
- Vercel builds static pages from the repository on every commit to `main`.

## Demo

https://a-proper-underground-blog.vercel.app

A few made-up pieces, so you can see the pages before installing. The editor at `/write` asks for a password: type `prova`, and what you write stays in your browser only.

## Install in ten steps

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ferdie-a/a-proper-underground-blog&env=BLOG_PASSWORD,GITHUB_TOKEN,GITHUB_REPO)

The button does steps 1, 3 and 4 in one go: it copies the repository into your GitHub account (choose a private one), creates the Vercel project and asks for the three variables. Then clone your new repository (`git clone https://github.com/<you>/<your-repo>.git` and `cd` into it), do step 2 and go on from step 5.

1. **Get your own copy.** Drafts, ideas and private notes are saved in the same repository, on the `drafts` branch, so the repository should be private. A GitHub fork of a public repository stays public, so the safer route is to create an empty private repository on GitHub and push a clone to it:

   ```
   git clone https://github.com/ferdie-a/a-proper-underground-blog.git my-blog
   cd my-blog
   git remote set-url origin https://github.com/<you>/<your-repo>.git
   git push -u origin main
   ```

   A plain fork works too, if you are fine with everything being public.

2. **Create the `drafts` branch.** It starts with no history and one file, a copy of `vercel.json`, whose `git.deploymentEnabled` rule tells Vercel never to build `drafts`:

   ```
   git switch --orphan drafts
   git checkout main -- vercel.json
   git commit -m "start drafts"
   git push -u origin drafts
   git switch main
   ```

3. **Create the Vercel project.** In Vercel, add a new project and import your repository. Leave the framework preset on "Other": the build command (`node build.js`), the output folder (`public`) and the headers come from `vercel.json`. In the project settings, set the production branch to `main`. The `drafts` branch is excluded by the rule in `vercel.json`.

4. **Add the three environment variables** (Settings, Environment Variables, Production):

   - `BLOG_PASSWORD`: the editor password, at least 32 characters. If it is shorter, the server refuses every request. Let a password manager generate it; you type it once per device.
   - `GITHUB_TOKEN`: a fine-grained personal access token (GitHub, Settings, Developer settings) limited to this one repository, with the repository permission Contents set to Read and write. Nothing else is needed. The token expires: when the editor says `GitHub token refused or expired`, make a new one, replace the variable and redeploy.
   - `GITHUB_REPO`: the repository as `owner/name`, for example `you/my-blog`.

   Do not set `BLOG_DEMO` on your own blog: it switches saving off. Variables apply from the next deployment; step 6 starts one.

5. **Edit `site.json`.**

   ```json
   {
     "name": "a proper underground blog",
     "shortName": "underground",
     "lang": "en",
     "learns": { "title": "Learns", "intro": "Short notes on things I just learned." }
   }
   ```

   - `name`: the title of the site, in the header, the browser tab, the home screen app and the 404 page.
   - `shortName`: optional, the label under the home screen icon. Without it, the first 12 characters of `name`.
   - `lang`: the `lang` attribute of every page.
   - `learns.title` and `learns.intro`: the title and the one-line intro of the learns box on the home page and of the `/learns` page.

   A missing field stops the build with a message that names it.

6. **Delete the demo pieces** and push:

   ```
   git rm posts/2026-10-01-hello-from-the-underground.txt posts/2026-10-15-why-plain-text.txt learns/2026-10-20-why-git-forgot-my-empty-folder.txt
   git commit -am "my blog"
   git push
   ```

   Vercel builds the site. The home page stays an empty list until you publish.

7. **Open `/write`** on your site and enter the password. The editor remembers it on that device until you choose `sign out`.

8. **Write and publish.** The first line is the title. `save` keeps the text on the device and uploads it to the `drafts` branch as soon as there is a network. `publish` asks whether it is a `post` or a `learn`, writes the file to `main`, and the page is online about a minute later.

9. **Add it to the home screen.** On an iPhone, open `/write` in Safari, tap Share, then Add to Home Screen. It opens full screen like an app and works offline: what you write waits on the device and goes up when the network is back.

10. **Optional: your own domain.** In Vercel, Settings, Domains. Nothing in the code depends on the address.

## Sections

Every file belongs to one of five sections. The bar of the editor has `save · files · new · publish · more`; `more` then `move to…` moves the open file to another section.

| Section | Branch | File | On the site |
|---|---|---|---|
| draft | `drafts` | `drafts/<name>.txt` (a variant: `drafts/<name>--<variant>.txt`) | no |
| idea | `drafts` | `ideas/<name>.txt` | no |
| private | `drafts` | `private/<name>.txt` | no |
| post | `main` | `posts/YYYY-MM-DD-<slug>.txt` | `/<slug>` |
| learn | `main` | `learns/YYYY-MM-DD-<slug>.txt` | `/learns/<slug>` |

Moving a file to `post` or `learn` publishes it. `delete` on a published piece takes it off the site and moves it to `private`, so one wrong tap never loses a finished text. The slug comes from the title: lowercase letters, digits and hyphens, at most 60 characters. The date is the day of the first publish and stays when you edit the piece later.

A file is the title on the first line, a blank line, the text as you wrote it, and at the end the block of times that the editor writes by itself:

```
Hello from the underground

This is the first post on a small blog that lives in a folder of text files.

--
started: 2026-09-30T21:40+00:00
finished: 2026-10-01T08:12+00:00
written: 34 min
sessions: 2
section: post
```

- `started`: when you pressed the first key, in local time with its offset.
- `finished`: when the piece was first published; its date is the date in the file name.
- `written`: minutes of actual typing; pauses longer than five minutes do not count.
- `sessions`: how many times you sat down to type, counting a new one after every pause longer than five minutes.
- `section`: the section the file belongs to; drafts have none.

The block never shows on the page. A key other than these five stops the build with the name of the file. A file written by hand can leave the block out.

The text is not interpreted: line breaks stay where they are, and addresses that start with `http://` or `https://` become links. That is all.

## Learns

A learn is a short piece about something you just learned. Its last lines are at least two questions with their answers, one per line:

```
pill: Does Git save empty folders? | No. It saves files and their paths, and a folder exists only as part of a path.
pill: What is a .gitkeep file? | An empty file placed in a folder so the folder has something to carry.
```

Only blank lines may follow them, before the `--` block. With fewer than two, or a `pill:` line missing its question or its answer, the editor does not publish and the build stops. The pills do not show on the page of the learn.

On `/learns`, the Learning Pill shows one question at a time, taken from all the learns, with its answer behind an arrow and a link to the piece it comes from. The question changes every six hours, and `skip` moves to the next. The home page shows a small box with the titles of the learns in rotation.

## What it is not

- Not a product with updates. There is no version and no changelog, and this repository sends no updates to the copies made from it: your copy is yours to change and to keep.
- No Markdown. Text is text.
- No comments in the code. The code is short, the names say what things do, and 250+ tests show how it behaves.
- No dependencies: nothing to install and nothing to keep up to date.

## Development

Node 22 or newer.

```
node dev.js --demo
```

Builds the site and serves it on http://127.0.0.1:3000 with a few sample pieces and a fake GitHub kept in memory. The editor is at `/write`, the password is `test`, and publishing rebuilds the pages. Without `--demo` it starts empty. It writes to `public/` and `.dev/`, both ignored by git.

```
node --test
```

Runs the whole suite.

`BLOG_DEMO=1` turns on the demo mode: the build adds a short note on top of every page and marks the editor page so that it accepts the password `prova` and keeps every save in the browser (`demo: saved in this browser only`), and the server refuses every request with `demo: saving is off`. To try it locally: `BLOG_DEMO=1 node dev.js --demo` (in PowerShell, `$env:BLOG_DEMO = "1"` first). To switch it off again: `Remove-Item Env:BLOG_DEMO` in PowerShell, `unset BLOG_DEMO` in bash.

## License

MIT, see `LICENSE`. The font is Inconsolata, under the SIL Open Font License 1.1: see `site/fonts/OFL.txt`.
