# Unpack.ai

## Run The Project

Install root runner dependencies once:

```bash
npm install
```

Start backend and frontend together:

```bash
npm run dev
```

Open the app:

```text
http://localhost:5173
```

Backend health check:

```text
http://localhost:5000/health
```

## Run Separately

Backend:

```bash
cd unpackai/server
npm run dev
```

Frontend:

```bash
cd unpackai/client
npm run dev
```

On Windows PowerShell, if `npm` is blocked by execution policy, use `npm.cmd` instead:

```bash
npm.cmd run dev
```
