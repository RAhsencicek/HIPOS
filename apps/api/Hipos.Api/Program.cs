using Hipos.Api.Features;
using Hipos.Api.Catalog;
using Hipos.Api.Sales;
using Hipos.Api.Cari;
using Hipos.Api.Service;
using Hipos.Api.Inventory;
using Hipos.Api.Cash;
using Hipos.Api.Expenses;
using Hipos.Api.Printing;
using Hipos.Api.Kitchen;
using Hipos.Api.Auth;
using Hipos.Api.Overview;
using Hipos.Api.Reports;
using Hipos.Api.Realtime;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
});
var featureRuntime = new FeatureRuntimeCapabilities();
builder.Services.AddSingleton(featureRuntime);
builder.Services.AddSingleton<IRestaurantEventHub, RestaurantEventHub>();

// TODO: X-Demo-Actor geçici kimlik çözümüdür — ileride gerçek auth (JWT vb.) eklenecek.
// Üretim kilidi kaldırıldı: artık Production ortamında da çalışır.

var storage = builder.Configuration["HIPOS_FEATURE_STORAGE"] ?? "memory";
if (storage == "postgres")
{
    var connection = builder.Configuration["HIPOS_FEATURES_CONNECTION"];
    if (string.IsNullOrWhiteSpace(connection))
        throw new InvalidOperationException("PostgreSQL modu için HIPOS_FEATURES_CONNECTION gerekli.");
    builder.Services.AddDbContext<FeatureDbContext>(options => options.UseNpgsql(connection));
    builder.Services.AddDbContext<CatalogDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "catalog")));
    builder.Services.AddDbContext<SalesDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "sales")));
    builder.Services.AddDbContext<CariDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "cari")));
    builder.Services.AddDbContext<ServiceDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "service")));
    builder.Services.AddDbContext<InventoryDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "inventory")));
    builder.Services.AddDbContext<CashDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "cash")));
    builder.Services.AddDbContext<ExpenseDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "finance")));
    builder.Services.AddDbContext<KitchenDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "kitchen")));
    builder.Services.AddDbContext<AuthDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "auth")));
    builder.Services.AddSingleton<AuthTokenService>();
    builder.Services.AddDbContext<OverviewDbContext>(options => options.UseNpgsql(connection,
        npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "overview")));
    builder.Services.AddScoped<IFeatureStore, PostgresFeatureStore>();
    builder.Services.AddScoped<CatalogQueries>();
    builder.Services.AddScoped<CatalogDraftCommands>();
    builder.Services.AddScoped<CatalogProductActivationCommands>();
    builder.Services.AddScoped<CatalogCategoryCommands>();
    builder.Services.AddScoped<CatalogOptionGroupCommands>();
    builder.Services.AddScoped<CatalogPublicationCommands>();
    builder.Services.AddHostedService<CatalogScheduledPriceWorker>();
    builder.Services.AddScoped<SalesOrders>();
    builder.Services.AddScoped<PaidCheckTableSettlement>();
    builder.Services.AddScoped<PaymentSimulator>();
    builder.Services.AddSingleton<FeatureNewWorkGate>();
    builder.Services.AddScoped<CashProvisioningService>();
    var printerConfig = new PrinterConfig();
    builder.Configuration.GetSection("Printers").Bind(printerConfig);
    builder.Services.AddSingleton(printerConfig);
    builder.Services.AddSingleton<PrinterTransport>();
    builder.Services.AddScoped<PrintingService>();
}
else if (storage == "memory")
    builder.Services.AddSingleton<IFeatureStore, InMemoryFeatureStore>();
else
    throw new InvalidOperationException("HIPOS_FEATURE_STORAGE yalnız 'memory' veya 'postgres' olabilir.");
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);
builder.Services.AddCors(options => options.AddPolicy("LocalPreview", policy =>
{
    // Yerel geliştirme ve LAN terminalleri (tablet, fiziksel kasa terminali, KDS vb.)
    policy.SetIsOriginAllowed(_ => true)
        .WithHeaders("Content-Type", "X-Demo-Actor", "Authorization")
        .WithMethods("GET", "PUT", "POST", "DELETE");
}));
var app = builder.Build();
var catalogReady = false;
var salesReady = false;
var cariReady = false;
var serviceReady = false;
var inventoryReady = false;
var cashReady = false;
var expensesReady = false;
var kitchenReady = false;
var authReady = false;
var overviewReady = false;
if (storage == "postgres")
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<FeatureDbContext>();
    await FeatureDbInitializer.EnsureDemoSeedAsync(db, CancellationToken.None);
    var catalogDb = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
    catalogReady = !(await catalogDb.Database.GetPendingMigrationsAsync()).Any();
    var salesDb = scope.ServiceProvider.GetRequiredService<SalesDbContext>();
    var pendingSalesMigrations = (await salesDb.Database.GetPendingMigrationsAsync()).ToArray();
    var postApiSalesMigrations = new[] { "SalesChecksRequireLinks", "SalesCheckForeignKeys" };
    salesReady = pendingSalesMigrations.All(migration => postApiSalesMigrations.Any(suffix =>
        migration.EndsWith(suffix, StringComparison.Ordinal)));
    var cariDb = scope.ServiceProvider.GetRequiredService<CariDbContext>();
    cariReady = !(await cariDb.Database.GetPendingMigrationsAsync()).Any();
    var serviceDb = scope.ServiceProvider.GetRequiredService<ServiceDbContext>();
    var pendingServiceMigrations = (await serviceDb.Database.GetPendingMigrationsAsync()).ToArray();
    serviceReady = salesReady && pendingServiceMigrations.All(migration =>
        migration.EndsWith("ServiceAssignmentsRequireCheckLinks", StringComparison.Ordinal));
    var inventoryDb = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
    inventoryReady = catalogReady && !(await inventoryDb.Database.GetPendingMigrationsAsync()).Any();
    var cashDb = scope.ServiceProvider.GetRequiredService<CashDbContext>();
    cashReady = !(await cashDb.Database.GetPendingMigrationsAsync()).Any();
    var expenseDb = scope.ServiceProvider.GetRequiredService<ExpenseDbContext>();
    expensesReady = !(await expenseDb.Database.GetPendingMigrationsAsync()).Any();
    var kitchenDb = scope.ServiceProvider.GetRequiredService<KitchenDbContext>();
    kitchenReady = salesReady && !(await kitchenDb.Database.GetPendingMigrationsAsync()).Any();
    var authDb = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
    authReady = !(await authDb.Database.GetPendingMigrationsAsync()).Any();
    if (authReady) await AuthDbInitializer.SeedDemoUsersAsync(authDb, CancellationToken.None);
    var overviewDb = scope.ServiceProvider.GetRequiredService<OverviewDbContext>();
    overviewReady = !(await overviewDb.Database.GetPendingMigrationsAsync()).Any();
    featureRuntime.CariReady = cariReady;
    if (serviceReady)
    {
        await ServiceDbContextFactory.EnsureFloorSchemaAsync(serviceDb, CancellationToken.None);
        await FeatureDbInitializer.PromoteServiceTablesAsync(db, CancellationToken.None);
        if (authReady)
        {
            await AuthDbInitializer.SynchronizeStaffAndAuthAsync(authDb, serviceDb, CancellationToken.None);
        }
    }
    if (cariReady) await FeatureDbInitializer.PromoteCariAsync(db, CancellationToken.None);
    if (inventoryReady) await FeatureDbInitializer.PromoteInventoryAsync(db, CancellationToken.None);
    featureRuntime.CatalogDraftsReady = catalogReady;
    featureRuntime.SalesOrdersReady = catalogReady && salesReady;
    featureRuntime.PaymentSimulatorReady = salesReady;
    featureRuntime.ServiceTablesReady = serviceReady;
    featureRuntime.InventoryReady = inventoryReady;
    featureRuntime.CashReady = cashReady;
    featureRuntime.ExpensesReady = expensesReady;
    featureRuntime.KitchenReady = kitchenReady;
    if (cashReady) await FeatureDbInitializer.PromoteCashAsync(db, CancellationToken.None);
}
app.UseCors("LocalPreview");
if (storage == "postgres") app.MapCariEndpoints(cariReady, cashReady);
if (storage == "postgres") app.MapServiceEndpoints(serviceReady);
if (storage == "postgres") app.MapInventoryEndpoints(inventoryReady);
if (storage == "postgres") app.MapProcurementEndpoints(inventoryReady);
if (storage == "postgres") app.MapInventoryCompletionEndpoints(inventoryReady);
if (storage == "postgres") app.MapCashEndpoints(cashReady, app.Environment.IsDevelopment());
if (storage == "postgres") app.MapExpenseEndpoints(expensesReady);
if (storage == "postgres") app.MapCatalogProductImageEndpoints(catalogReady);
if (storage == "postgres") app.MapCatalogScheduledPriceEndpoints(catalogReady);
if (storage == "postgres") app.MapCatalogMenuEndpoints(catalogReady);
if (storage == "postgres") app.MapPublicQrMenuEndpoints(catalogReady);
if (storage == "postgres") app.MapCatalogOptionGroupEndpoints(catalogReady);
if (storage == "postgres") app.MapSalesCheckEndpoints(salesReady, serviceReady, app.Environment.IsDevelopment(), authReady);
if (storage == "postgres") app.MapKitchenEndpoints(kitchenReady);
if (storage == "postgres") app.MapPrintingEndpoints();
if (storage == "postgres") app.MapAuthEndpoints(authReady);
if (storage == "postgres") app.MapOverviewEndpoints(overviewReady);
if (storage == "postgres") app.MapReportsEndpoints(salesReady);
if (storage == "postgres") app.MapRealtimeEndpoints();

app.MapGet("/health", () => Results.Ok(new { status = "prototype", storage }));

app.MapGet("/api/v1/firms/{firmId}/catalog/products",
    async (string firmId, string? branchId, string? query, string? categoryId,
        int? page, int? pageSize, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!DemoAccess.CanReadCatalog(actor, firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu firma/şube kataloğuna erişim izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var requestedPage = page ?? 1;
        var requestedSize = pageSize ?? 25;
        if (requestedPage is < 1 or > 100000 || requestedSize is < 1 or > 100)
            return Failure(context, "INVALID_PAGINATION", 400, "page 1–100000, pageSize 1–100 arasında olmalı.");
        var result = await services.GetRequiredService<CatalogQueries>().ListAsync(
            new CatalogScope(firmId, branchId), query, categoryId, requestedPage, requestedSize, context.RequestAborted);
        return Results.Ok(result);
    });

app.MapGet("/api/v1/firms/{firmId}/catalog/categories",
    async (string firmId, string? branchId, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (string.IsNullOrWhiteSpace(branchId))
            return Failure(context, "BRANCH_REQUIRED", 400, "Kategorileri görüntülemek için bir şube seçin.");
        if (!DemoAccess.CanReadCatalog(actor, firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu firma/şube kategorilerine erişim izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var result = await services.GetRequiredService<CatalogQueries>().ListCategoriesAsync(
            new CatalogScope(firmId, branchId), context.RequestAborted);
        return Results.Ok(result);
    });

app.MapPost("/api/v1/firms/{firmId}/catalog/categories",
    async (string firmId, string? branchId, CreateCatalogCategory command, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (string.IsNullOrWhiteSpace(branchId))
            return Failure(context, "BRANCH_REQUIRED", 400, "Kategori oluşturmak için bir şube seçin.");
        if (!actor.CanManage || !DemoAccess.CanReadCatalog(actor, firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede kategori yönetme izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var result = await services.GetRequiredService<CatalogCategoryCommands>().CreateAsync(
            firmId, branchId, command, actor.Name, context.RequestAborted);
        if (result.Failure is { } failure)
            return Failure(context, failure.Code, failure.Status, failure.Message);
        return result.Created
            ? Results.Created($"/api/v1/firms/{firmId}/catalog/categories/{result.Category!.Id}?branchId={branchId}", result.Category)
            : Results.Ok(result.Category);
    });

app.MapPut("/api/v1/firms/{firmId}/catalog/categories/{categoryId}",
    async (string firmId, string categoryId, string? branchId, RenameCatalogCategory command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (string.IsNullOrWhiteSpace(branchId))
            return Failure(context, "BRANCH_REQUIRED", 400, "Kategori düzenlemek için bir şube seçin.");
        if (!actor.CanManage || !DemoAccess.CanReadCatalog(actor, firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede kategori yönetme izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var result = await services.GetRequiredService<CatalogCategoryCommands>().RenameAsync(
            firmId, branchId, categoryId, command, actor.Name, context.RequestAborted);
        return result.Failure is { } failure
            ? Failure(context, failure.Code, failure.Status, failure.Message)
            : Results.Ok(result.Category);
    });

app.MapPut("/api/v1/firms/{firmId}/catalog/categories/{categoryId}/active",
    async (string firmId, string categoryId, string? branchId, SetCatalogCategoryActive command, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (string.IsNullOrWhiteSpace(branchId)) return Failure(context, "BRANCH_REQUIRED", 400, "Önce bir şube seçin.");
        if (!actor.CanManage || !DemoAccess.CanReadCatalog(actor, firmId, branchId)) return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede kategori yönetme izni yok.");
        if (!catalogReady) return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog veritabanı hazır değil.");
        var result = await services.GetRequiredService<CatalogCategoryCommands>().SetActiveAsync(firmId, branchId, categoryId, command, actor.Name, context.RequestAborted);
        return result.Failure is { } failure ? Failure(context, failure.Code, failure.Status, failure.Message) : Results.Ok(result.Category);
    });

app.MapPut("/api/v1/firms/{firmId}/catalog/categories/{categoryId}/position",
    async (string firmId, string categoryId, string? branchId, MoveCatalogCategory command, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (string.IsNullOrWhiteSpace(branchId)) return Failure(context, "BRANCH_REQUIRED", 400, "Önce bir şube seçin.");
        if (!actor.CanManage || !DemoAccess.CanReadCatalog(actor, firmId, branchId)) return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede kategori yönetme izni yok.");
        if (!catalogReady) return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog veritabanı hazır değil.");
        var failure = await services.GetRequiredService<CatalogCategoryCommands>().MoveAsync(firmId, branchId, categoryId, command, actor.Name, context.RequestAborted);
        return failure is { } error ? Failure(context, error.Code, error.Status, error.Message) : Results.NoContent();
    });

app.MapDelete("/api/v1/firms/{firmId}/catalog/categories/{categoryId}",
    async (string firmId, string categoryId, string? branchId, int expectedVersion,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (string.IsNullOrWhiteSpace(branchId))
            return Failure(context, "BRANCH_REQUIRED", 400, "Kategori silmek için bir şube seçin.");
        if (!actor.CanManage || !DemoAccess.CanReadCatalog(actor, firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede kategori yönetme izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var failure = await services.GetRequiredService<CatalogCategoryCommands>().DeleteAsync(
            firmId, branchId, categoryId, new DeleteCatalogCategory(expectedVersion), actor.Name, context.RequestAborted);
        return failure is { } result ? Failure(context, result.Code, result.Status, result.Message) : Results.NoContent();
    });

app.MapGet("/api/v1/firms/{firmId}/catalog/products/{productId}",
    async (string firmId, string productId, string? branchId, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!DemoAccess.CanReadCatalog(actor, firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu firma/şube kataloğuna erişim izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        if (!Guid.TryParse(productId, out var id))
            return Failure(context, "PRODUCT_NOT_FOUND", 404, "Ürün bu kapsamda bulunamadı.");
        var result = await services.GetRequiredService<CatalogQueries>().GetAsync(
            new CatalogScope(firmId, branchId), id, context.RequestAborted);
        return result is null ? Failure(context, "PRODUCT_NOT_FOUND", 404, "Ürün bu kapsamda bulunamadı.") : Results.Ok(result);
    });

app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}",
    async (string firmId, string branchId, string productId, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!DemoAccess.CanReadCatalog(actor, firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu firma/şube kataloğuna erişim izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        if (!Guid.TryParse(productId, out var id))
            return Failure(context, "PRODUCT_NOT_FOUND", 404, "Ürün bu kapsamda bulunamadı.");
        var result = await services.GetRequiredService<CatalogQueries>().GetAsync(
            new CatalogScope(firmId, branchId), id, context.RequestAborted);
        return result is null ? Failure(context, "PRODUCT_NOT_FOUND", 404, "Ürün bu kapsamda bulunamadı.") : Results.Ok(result);
    });

app.MapPut("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/channels",
    async (string firmId, string branchId, Guid productId, SetCatalogProductChannels command, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanManage || !actor.CanRead(firmId, branchId)) return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede kanal yönetme izni yok.");
        if (!catalogReady) return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var result = await services.GetRequiredService<CatalogProductActivationCommands>().SetChannelsAsync(firmId, branchId, productId, command, actor.Name, context.RequestAborted);
        return result.Failure is { } failure ? Failure(context, failure.Code, failure.Status, failure.Message) : Results.Ok(new { desiredChannels = result.Channels, version = result.Version });
    });

app.MapPost("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/activation",
    async (string firmId, string branchId, string productId, SetCatalogProductActive command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanManage || !actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede ürün durumu yönetme izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        if (!Guid.TryParse(productId, out var id))
            return Failure(context, "PRODUCT_NOT_FOUND", 404, "Ürün bu kapsamda bulunamadı.");
        var result = await services.GetRequiredService<CatalogProductActivationCommands>().SetActiveAsync(
            firmId, branchId, id, command, actor.Name, context.RequestAborted);
        if (result.Failure is { } failure)
            return Failure(context, failure.Code, failure.Status, failure.Message);
        return Results.Ok(new { id = result.ProductId, isActive = result.IsActive,
            version = result.Version, replayed = result.Replayed });
    });

app.MapPost("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products",
    async (string firmId, string branchId, CreatePricedProduct command, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanManage || !actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede ürün oluşturma izni yok.");
        if (!catalogReady) return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı.");
        var result = await services.GetRequiredService<CatalogDraftCommands>().CreatePricedAsync(
            firmId, branchId, command, actor.Name, context.RequestAborted);
        if (result.Failure is { } failure) return Failure(context, failure.Code, failure.Status, failure.Message);
        return result.Created
            ? Results.Created($"/api/v1/firms/{firmId}/catalog/products/{result.Product!.Id}?branchId={branchId}", result.Product)
            : Results.Ok(result.Product);
    });

app.MapPut("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}",
    async (string firmId, string branchId, string productId, UpdatePublishedProduct command, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanManage || !actor.CanRead(firmId, branchId)) return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede ürün düzenleme izni yok.");
        if (!catalogReady) return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı.");
        if (!Guid.TryParse(productId, out var id)) return Failure(context, "PRODUCT_NOT_FOUND", 404, "Ürün bulunamadı.");
        var result = await services.GetRequiredService<CatalogDraftCommands>().UpdatePublishedAsync(
            firmId, branchId, id, command, actor.Name, context.RequestAborted);
        return result.Failure is { } failure ? Failure(context, failure.Code, failure.Status, failure.Message) : Results.Ok(result.Product);
    });

app.MapPost("/api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts",
    async (string firmId, string branchId, CreateProductDraft command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || !actor.CanManage)
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede taslak yönetme izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var result = await services.GetRequiredService<CatalogDraftCommands>().CreateAsync(
            firmId, branchId, command, actor.Name, context.RequestAborted);
        if (result.Failure is { } failure)
            return Failure(context, failure.Code, failure.Status, failure.Message);
        return result.Created
            ? Results.Created($"/api/v1/firms/{firmId}/catalog/products/{result.Product!.Id}?branchId={branchId}", result.Product)
            : Results.Ok(result.Product);
    });

app.MapPut("/api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}",
    async (string firmId, string branchId, string draftId, UpdateProductDraft command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || !actor.CanManage)
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede taslak yönetme izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        if (!Guid.TryParse(draftId, out var id))
            return Failure(context, "PRODUCT_NOT_FOUND", 404, "Taslak bulunamadı.");
        var result = await services.GetRequiredService<CatalogDraftCommands>().UpdateAsync(
            firmId, branchId, id, command, actor.Name, context.RequestAborted);
        return result.Failure is { } failure
            ? Failure(context, failure.Code, failure.Status, failure.Message)
            : Results.Ok(result.Product);
    });

app.MapPut("/api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}/price",
    async (string firmId, string branchId, string draftId, SetDraftPrice command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanManage || !actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede fiyat hazırlama izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı.");
        if (!Guid.TryParse(draftId, out var id))
            return Failure(context, "DRAFT_NOT_FOUND", 404, "Taslak bulunamadı.");
        var result = await services.GetRequiredService<CatalogPublicationCommands>().SetPriceAsync(
            firmId, branchId, id, command, actor.Name, context.RequestAborted);
        if (result.Failure is { } failure)
            return Failure(context, failure.Code, failure.Status, failure.Message);
        if (result.Product is null || result.PriceVersion is null)
            return Failure(context, "PRICE_INCONSISTENT", 503, "Fiyat kaydı okunamadı.");
        var response = new { product = result.Product, priceVersion = result.PriceVersion };
        return result.Created
            ? Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{id}/price-versions", response)
            : Results.Ok(response);
    });

app.MapPut("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/price",
    async (string firmId, string branchId, string productId, SetDraftPrice command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanManage || !actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede fiyat değiştirme izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı.");
        if (!Guid.TryParse(productId, out var id))
            return Failure(context, "PRODUCT_NOT_FOUND", 404, "Ürün bulunamadı.");
        var result = await services.GetRequiredService<CatalogPublicationCommands>().RepricePublishedAsync(
            firmId, branchId, id, command, actor.Name, context.RequestAborted);
        if (result.Failure is { } failure) return Failure(context, failure.Code, failure.Status, failure.Message);
        if (result.Product is null || result.PriceVersion is null)
            return Failure(context, "PRICE_INCONSISTENT", 503, "Fiyat kaydı okunamadı.");
        var response = new { product = result.Product, priceVersion = result.PriceVersion };
        return result.Created
            ? Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{id}/price-versions", response)
            : Results.Ok(response);
    });

app.MapPost("/api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}/publish",
    async (string firmId, string branchId, string draftId, PublishProductDraft command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanManage || !actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede ürün yayınlama izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı.");
        if (!Guid.TryParse(draftId, out var id))
            return Failure(context, "DRAFT_NOT_FOUND", 404, "Taslak bulunamadı.");
        var result = await services.GetRequiredService<CatalogPublicationCommands>().PublishAsync(
            firmId, branchId, id, command, actor.Name, context.RequestAborted);
        if (result.Failure is { } failure)
            return Failure(context, failure.Code, failure.Status, failure.Message);
        if (result.Product is null || result.Publication is null)
            return Failure(context, "PUBLICATION_INCONSISTENT", 503, "Yayın kaydı okunamadı.");
        var response = new { product = result.Product, publication = result.Publication };
        return result.Created
            ? Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{id}/publications", response)
            : Results.Ok(response);
    });

app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/price-versions",
    async (string firmId, string branchId, string productId, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || actor.CanOperate)
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubenin fiyat geçmişine erişim izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı.");
        if (!Guid.TryParse(productId, out var id) ||
            await services.GetRequiredService<CatalogQueries>().GetAsync(new CatalogScope(firmId, branchId), id, context.RequestAborted) is null)
            return Failure(context, "PRODUCT_NOT_FOUND", 404, "Ürün bulunamadı.");
        return Results.Ok(await services.GetRequiredService<CatalogPublicationCommands>()
            .PriceHistoryAsync(firmId, branchId, id, context.RequestAborted));
    });

app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/publications",
    async (string firmId, string branchId, string productId, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || actor.CanOperate)
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubenin yayın geçmişine erişim izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı.");
        if (!Guid.TryParse(productId, out var id) ||
            await services.GetRequiredService<CatalogQueries>().GetAsync(new CatalogScope(firmId, branchId), id, context.RequestAborted) is null)
            return Failure(context, "PRODUCT_NOT_FOUND", 404, "Ürün bulunamadı.");
        return Results.Ok(await services.GetRequiredService<CatalogPublicationCommands>()
            .PublicationHistoryAsync(firmId, branchId, id, context.RequestAborted));
    });

app.MapGet("/api/v1/firms/{firmId}/sales/orders",
    async (string firmId, string? branchId, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if ((actor.CanOperate && branchId is null) || !DemoAccess.CanReadCatalog(actor, firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu firma/şube siparişlerini izleme izni yok.");
        if (!salesReady)
            return Failure(context, "SALES_STORAGE_UNAVAILABLE", 503, "Satış migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var orders = await services.GetRequiredService<SalesOrders>().ListAsync(
            firmId, branchId, context.RequestAborted);
        return Results.Ok(new { scope = new { firmId, branchId }, items = orders });
    });

app.MapPost("/api/v1/firms/{firmId}/branches/{branchId}/sales/orders",
    async (string firmId, string branchId, CreatePosOrder command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanOperate || !actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede POS siparişi oluşturma izni yok.");
        if (!catalogReady || !salesReady)
            return Failure(context, "SALES_STORAGE_UNAVAILABLE", 503, "Katalog ve satış migration'ları uygulanmalı.");
        var check = new SalesCheckRow
        {
            Id = command.OrderId, FirmId = firmId, BranchId = branchId, Status = "open",
            Currency = "TRY", CreatedAt = DateTimeOffset.UtcNow, Version = 1,
        };
        var result = await services.GetRequiredService<SalesOrders>().CreateAsync(
            firmId, branchId, command, actor.Name, context.RequestAborted,
            command.OrderId, check, "sales.pos_orders", "test_pos");
        if (result.Failure is { } failure)
            return Failure(context, failure.Code, failure.Status, failure.Message);
        return result.Created
            ? Results.Created($"/api/v1/firms/{firmId}/sales/orders?branchId={branchId}", result.Order)
            : Results.Ok(result.Order);
    });

app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/sales/orders/{orderId}",
    async (string firmId, string branchId, string orderId, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubenin siparişini okuma izni yok.");
        if (!salesReady)
            return Failure(context, "SALES_STORAGE_UNAVAILABLE", 503, "Satış migration'ı uygulanmalı.");
        if (!Guid.TryParse(orderId, out var id))
            return Failure(context, "ORDER_NOT_FOUND", 404, "Sipariş bulunamadı.");
        var order = await services.GetRequiredService<SalesOrders>().GetAsync(
            firmId, branchId, id, context.RequestAborted);
        return order is null
            ? Failure(context, "ORDER_NOT_FOUND", 404, "Sipariş bulunamadı.")
            : Results.Ok(order);
    });

app.MapPost("/api/v1/firms/{firmId}/branches/{branchId}/sales/orders/{orderId}/payment-attempts",
    async (string firmId, string branchId, string orderId, StartSimulatedPayment command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanOperate || !actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede test ödeme girişimi başlatma izni yok.");
        if (!salesReady)
            return Failure(context, "PAYMENT_STORAGE_UNAVAILABLE", 503, "Satış migration'ı uygulanmalı.");
        if (!Guid.TryParse(orderId, out var id))
            return Failure(context, "ORDER_NOT_FOUND", 404, "Sipariş bulunamadı.");
        var result = await services.GetRequiredService<PaymentSimulator>().StartAsync(
            firmId, branchId, id, command, actor.Name, context.RequestAborted);
        if (result.Failure is { } failure)
            return Failure(context, failure.Code, failure.Status, failure.Message);
        var response = new { attempt = result.Attempt, order = result.Order };
        return result.Created
            ? Results.Created($"/api/v1/firms/{firmId}/branches/{branchId}/sales/orders/{id}/payment-attempts/{result.Attempt!.Id}", response)
            : Results.Ok(response);
    });

app.MapPost("/api/v1/firms/{firmId}/branches/{branchId}/sales/orders/{orderId}/payment-attempts/{attemptId}/resolve",
    async (string firmId, string branchId, string orderId, string attemptId, ResolveSimulatedPayment command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanOperate || !actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede test ödeme sonucu doğrulama izni yok.");
        if (!salesReady)
            return Failure(context, "PAYMENT_STORAGE_UNAVAILABLE", 503, "Satış migration'ı uygulanmalı.");
        if (!Guid.TryParse(orderId, out var id) || !Guid.TryParse(attemptId, out var paymentId))
            return Failure(context, "PAYMENT_NOT_FOUND", 404, "Ödeme girişimi bulunamadı.");
        var result = await services.GetRequiredService<PaymentSimulator>().ResolveAsync(
            firmId, branchId, id, paymentId, command, actor.Name, context.RequestAborted);
        return result.Failure is { } failure
            ? Failure(context, failure.Code, failure.Status, failure.Message)
            : Results.Ok(new { attempt = result.Attempt, order = result.Order });
    });

app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/sales/orders/{orderId}/payment-attempts",
    async (string firmId, string branchId, string orderId, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubenin ödeme geçmişine erişim izni yok.");
        if (!salesReady)
            return Failure(context, "PAYMENT_STORAGE_UNAVAILABLE", 503, "Satış migration'ı uygulanmalı.");
        if (!Guid.TryParse(orderId, out var id))
            return Failure(context, "ORDER_NOT_FOUND", 404, "Sipariş bulunamadı.");
        var order = await services.GetRequiredService<SalesDbContext>().Orders.AsNoTracking()
            .AnyAsync(row => row.Id == id && row.FirmId == firmId && row.BranchId == branchId, context.RequestAborted);
        if (!order) return Failure(context, "ORDER_NOT_FOUND", 404, "Sipariş bulunamadı.");
        return Results.Ok(await services.GetRequiredService<PaymentSimulator>()
            .ListAsync(firmId, branchId, id, context.RequestAborted));
    });

app.MapGet("/api/v1/features/definitions", (HttpContext context) =>
{
    var actor = DemoAccess.Resolve(context);
    if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
    context.Response.Headers["X-Feature-Catalog-Version"] = FeatureCatalog.CatalogVersion.ToString();
    return Results.Ok(FeatureCatalog.All);
});

app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/features",
    async (string firmId, string branchId, HttpContext context, IFeatureStore store) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu firma/şube modül ayarına erişim izni yok.");
        return Results.Ok(await store.ListAsync(firmId, branchId, context.RequestAborted));
    });

app.MapPut("/api/v1/firms/{firmId}/branches/{branchId}/features/{featureKey}",
    async (string firmId, string branchId, string featureKey, SetFeatureDesiredState command,
        HttpContext context, IFeatureStore store) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || !actor.CanManage)
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede modül değiştirme izni yok.");
        if (command.ExpectedVersion < 1)
            return Failure(context, "INVALID_VERSION", 400, "expectedVersion pozitif olmalı.");
        var result = await store.SetDesiredAsync(firmId, branchId, featureKey, command, actor.Name, context.RequestAborted);
        return result.Failure is { } error
            ? Failure(context, error.Code, error.Status, error.Message)
            : Results.Ok(result.State);
    });

app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/features/audit",
    async (string firmId, string branchId, HttpContext context, IFeatureStore store) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubenin denetim kaydına erişim izni yok.");
        return Results.Ok(await store.AuditAsync(firmId, branchId, context.RequestAborted));
    });

app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/features/{featureKey}/new-work-policy",
    async (string firmId, string branchId, string featureKey, HttpContext context, IFeatureStore store) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubenin modül durumuna erişim izni yok.");
        var state = (await store.ListAsync(firmId, branchId, context.RequestAborted)).FirstOrDefault(item => item.Key == featureKey);
        if (state is null) return Failure(context, "FEATURE_NOT_FOUND", 404, "Özellik bulunamadı.");
        return Results.Ok(new { allowed = await store.CanStartNewWorkAsync(firmId, branchId, featureKey, context.RequestAborted), lifecycle = state.Lifecycle });
    });

app.MapPost("/_prototype/firms/{firmId}/branches/{branchId}/features/{featureKey}/complete-one-work",
    async (string firmId, string branchId, string featureKey, HttpContext context, IFeatureStore store) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanRead(firmId, branchId) || !actor.CanManage)
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu şubede prototip olay izni yok.");
        var result = await store.CompleteOneInFlightWorkAsync(firmId, branchId, featureKey, context.RequestAborted);
        return result.Failure is { } error
            ? Failure(context, error.Code, error.Status, error.Message)
            : Results.Ok(result.State);
    });

app.Run();

static IResult Failure(HttpContext context, string code, int status, string detail) =>
    Results.Json(new
    {
        type = $"https://hipos.local/problems/{code.ToLowerInvariant().Replace('_', '-')}",
        title = status switch { 401 => "Oturum gerekli", 403 => "Yetkisiz kapsam", 404 => "Bulunamadı", 409 => "İşlem çakışması", _ => "İstek hatası" },
        status,
        detail,
        instance = context.Request.Path.Value,
        code,
        traceId = context.TraceIdentifier,
    }, statusCode: status, contentType: "application/problem+json");
