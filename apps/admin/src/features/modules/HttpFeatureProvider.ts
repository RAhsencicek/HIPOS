import type {
  BranchFeatureState,
  FeatureDefinition,
  FeatureProvider,
  FeatureScope,
  SetFeatureDesiredState,
} from "./contracts";
import { FeatureProviderError } from "./contracts";

type ApiProblem = { code?: string; detail?: string };

// Yalnız yerel .NET prototipi: X-Demo-Actor gerçek oturum veya üretim yetkisi değildir.
export class HttpFeatureProvider implements FeatureProvider {
  constructor(private readonly baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180") {}

  private actor(scope?: FeatureScope): string {
    return scope?.firmId === "11111111-1111-4111-8111-111111111111"
      ? "manager-single"
      : "manager-multi";
  }

  private async request<T>(
    path: string,
    scope?: FeatureScope,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: body ? "PUT" : "GET",
        headers: {
          "X-Demo-Actor": this.actor(scope),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new FeatureProviderError(
        "LOAD_FAILED",
        503,
        "Yerel .NET prototipine bağlanılamadı.",
      );
    }
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as ApiProblem;
      throw new FeatureProviderError(
        (problem.code ?? "LOAD_FAILED") as FeatureProviderError["code"],
        response.status,
        problem.detail ?? "Modül işlemi tamamlanamadı.",
      );
    }
    return response.json() as Promise<T>;
  }

  listDefinitions(): Promise<FeatureDefinition[]> {
    return this.request("/api/v1/features/definitions");
  }

  listBranchStates(scope: FeatureScope): Promise<BranchFeatureState[]> {
    return this.request(this.branchPath(scope), scope);
  }

  setDesiredEnabled(
    command: SetFeatureDesiredState,
  ): Promise<BranchFeatureState> {
    return this.request(
      `${this.branchPath(command)}/${encodeURIComponent(command.key)}`,
      command,
      {
        desiredEnabled: command.desiredEnabled,
        expectedVersion: command.expectedVersion,
      },
    );
  }

  private branchPath(scope: FeatureScope): string {
    return `/api/v1/firms/${encodeURIComponent(scope.firmId)}/branches/${encodeURIComponent(scope.branchId)}/features`;
  }
}
