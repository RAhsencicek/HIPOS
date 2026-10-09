namespace Hipos.Api.Features;

// Yalnız geliştirme prototipinde migration hazır olup olmadığını yansıtır.
public sealed class FeatureRuntimeCapabilities
{
    public bool CatalogDraftsReady { get; set; }
    public bool SalesOrdersReady { get; set; }
    public bool PaymentSimulatorReady { get; set; }
    public bool ServiceTablesReady { get; set; }
    public bool InventoryReady { get; set; }
}
