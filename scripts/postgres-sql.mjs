import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const composeFile = fileURLToPath(new URL("../compose.yaml", import.meta.url));

export async function runLocalPostgresSql(databaseUrl, sql) {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.slice(1);
  const environment = [
    "-e", "PGHOST=/var/run/postgresql",
    "-e", "PGPORT=5432",
    "-e", `PGUSER=${decodeURIComponent(parsed.username)}`,
    "-e", `PGPASSWORD=${decodeURIComponent(parsed.password)}`,
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
