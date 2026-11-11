import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const composeFile = fileURLToPath(new URL("../compose.yaml", import.meta.url));

export async function runLocalPostgresSql(databaseUrl, sql) {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.slice(1);
  const host = parsed.hostname || "127.0.0.1";
  const port = parsed.port || "5432";
  const user = decodeURIComponent(parsed.username || "hipos");
  const password = decodeURIComponent(parsed.password || "hipos-dev-only");

  // If psql is available directly in the environment (e.g. inside seed container)
  try {
    const env = {
      ...process.env,
      PGHOST: host,
      PGPORT: port,
      PGUSER: user,
      PGPASSWORD: password,
      PGDATABASE: database,
    };
    const psqlChild = spawn("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], { env, stdio: ["pipe", "inherit", "inherit"] });
    psqlChild.stdin.end(sql);
    const code = await new Promise((resolve) => {
      psqlChild.on("error", () => resolve(-1));
      psqlChild.on("close", resolve);
    });
    if (code === 0) return;
    if (code > 0) throw new Error(`psql işlemi hata ile sonlandı (çıkış kodu: ${code}).`);
  } catch (err) {
    if (err.message && err.message.includes("psql işlemi")) throw err;
  }

  const environment = [
    "-e", "PGHOST=/var/run/postgresql",
    "-e", "PGPORT=5432",
    "-e", `PGUSER=${user}`,
    "-e", `PGPASSWORD=${password}`,
    "-e", `PGDATABASE=${database}`,
  ];
  const container = process.env.HIPOS_POSTGRES_CONTAINER;
  const args = container
    ? ["exec", "-i", ...environment, container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
    : ["compose", "-f", composeFile, "exec", "-T", ...environment, "db", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"];
  const child = spawn("docker", args, { stdio: ["pipe", "inherit", "inherit"] });
  child.stdin.end(sql);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`Docker PostgreSQL SQL işlemi başarısız oldu (çıkış kodu: ${code ?? "yok"}).`);
}
