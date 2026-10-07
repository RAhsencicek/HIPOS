namespace Hipos.Api.Features;

// Yalnız geliştirme prototipinde migration hazır olup olmadığını yansıtır.
public sealed class FeatureRuntimeCapabilities
{
    public bool CatalogDraftsReady { get; set; }
    public bool SalesOrdersReady { get; set; }
}
