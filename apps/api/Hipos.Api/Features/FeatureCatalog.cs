using System.Text.Json;

namespace Hipos.Api.Features;

public static class FeatureCatalog
{
    private sealed record Document(int SchemaVersion, int CatalogVersion, List<FeatureDefinition> Definitions);

    private static readonly Document Source = Load();

    public static int SchemaVersion => Source.SchemaVersion;
    public static int CatalogVersion => Source.CatalogVersion;
    public static IReadOnlyList<FeatureDefinition> All => Source.Definitions;

    private static Document Load()
    {
        using var stream = typeof(FeatureCatalog).Assembly.GetManifestResourceStream("Hipos.FeatureCatalog.v1.json")
            ?? throw new InvalidOperationException("Paylaşılan özellik sözleşmesi bulunamadı.");
        var document = JsonSerializer.Deserialize<Document>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("Özellik sözleşmesi okunamadı.");
        if (document.SchemaVersion != 1 || document.CatalogVersion < 1 || document.Definitions is not { Count: > 0 })
            throw new InvalidOperationException("Desteklenmeyen veya boş özellik sözleşmesi.");

        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var definition in document.Definitions)
        {
            if (string.IsNullOrWhiteSpace(definition.Key) || !keys.Add(definition.Key) ||
                definition.ScopeType != "branch" ||
                definition.Availability is not ("real" or "backend_preview" or "prototype" or "planned") ||
                definition.Dependencies is null)
                throw new InvalidOperationException($"Geçersiz özellik tanımı: {definition.Key}");
        }
        foreach (var definition in document.Definitions)
            if (definition.Dependencies.Any(dependency => !keys.Contains(dependency) || dependency == definition.Key))
                throw new InvalidOperationException($"Geçersiz özellik bağımlılığı: {definition.Key}");

        var visiting = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var byKey = document.Definitions.ToDictionary(definition => definition.Key, StringComparer.Ordinal);
        foreach (var key in keys) Visit(key);
        return document;

        void Visit(string key)
        {
            if (visited.Contains(key)) return;
            if (!visiting.Add(key)) throw new InvalidOperationException($"Döngüsel özellik bağımlılığı: {key}");
            foreach (var dependency in byKey[key].Dependencies) Visit(dependency);
            visiting.Remove(key);
            visited.Add(key);
        }
    }
}
