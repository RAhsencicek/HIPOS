using Hipos.Api.Features;
using Hipos.Api.Catalog;
using Hipos.Api.Sales;
using Hipos.Api.Cari;
using Hipos.Api.Service;
using Hipos.Api.Inventory;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);
var featureRuntime = new FeatureRuntimeCapabilities();
builder.Services.AddSingleton(featureRuntime);

// X-Demo-Actor gerçek kimlik doğrulaması değildir; yanlışlıkla üretimde çalıştırılamaz.
if (!builder.Environment.IsDevelopment())
    throw new InvalidOperationException("Feature prototipi yalnız Development ortamında çalışır.");

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
    builder.Services.AddScoped<IFeatureStore, PostgresFeatureStore>();
    builder.Services.AddScoped<CatalogQueries>();
    builder.Services.AddScoped<CatalogDraftCommands>();
    builder.Services.AddScoped<CatalogCategoryCommands>();
    builder.Services.AddScoped<CatalogPublicationCommands>();
    builder.Services.AddScoped<SalesOrders>();
    builder.Services.AddScoped<PaymentSimulator>();
    builder.Services.AddSingleton<FeatureNewWorkGate>();
}
else if (storage == "memory")
    builder.Services.AddSingleton<IFeatureStore, InMemoryFeatureStore>();
else
    throw new InvalidOperationException("HIPOS_FEATURE_STORAGE yalnız 'memory' veya 'postgres' olabilir.");
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);
builder.Services.AddCors(options => options.AddPolicy("LocalPreview", policy =>
    policy.WithOrigins("http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:5174", "http://127.0.0.1:5174",
            "http://localhost:5176", "http://127.0.0.1:5176",
            "http://localhost:5177", "http://127.0.0.1:5177")
        .WithHeaders("Content-Type", "X-Demo-Actor")
        .WithMethods("GET", "PUT", "POST", "DELETE")));
var app = builder.Build();
var catalogReady = false;
var salesReady = false;
var cariReady = false;
var serviceReady = false;
var inventoryReady = false;
if (storage == "postgres")
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<FeatureDbContext>();
    await FeatureDbInitializer.EnsureDemoSeedAsync(db, CancellationToken.None);
    var catalogDb = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
    catalogReady = !(await catalogDb.Database.GetPendingMigrationsAsync()).Any();
    var salesDb = scope.ServiceProvider.GetRequiredService<SalesDbContext>();
    salesReady = !(await salesDb.Database.GetPendingMigrationsAsync()).Any();
    var cariDb = scope.ServiceProvider.GetRequiredService<CariDbContext>();
    cariReady = !(await cariDb.Database.GetPendingMigrationsAsync()).Any();
    var serviceDb = scope.ServiceProvider.GetRequiredService<ServiceDbContext>();
    serviceReady = salesReady && !(await serviceDb.Database.GetPendingMigrationsAsync()).Any();
    var inventoryDb = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
    inventoryReady = catalogReady && !(await inventoryDb.Database.GetPendingMigrationsAsync()).Any();
    if (serviceReady) await FeatureDbInitializer.PromoteServiceTablesAsync(db, CancellationToken.None);
    featureRuntime.CatalogDraftsReady = catalogReady;
    featureRuntime.SalesOrdersReady = catalogReady && salesReady;
    featureRuntime.PaymentSimulatorReady = salesReady;
    featureRuntime.ServiceTablesReady = serviceReady;
    featureRuntime.InventoryReady = inventoryReady;
}
app.UseCors("LocalPreview");
if (storage == "postgres") app.MapCariEndpoints(cariReady);
if (storage == "postgres") app.MapServiceEndpoints(serviceReady);
if (storage == "postgres") app.MapInventoryEndpoints(inventoryReady);
if (storage == "postgres") app.MapCatalogMenuEndpoints(catalogReady);

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
        if (!DemoAccess.CanReadCatalog(actor, firmId, branchId))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Bu firma/şube kategorilerine erişim izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var result = await services.GetRequiredService<CatalogQueries>().ListCategoriesAsync(
            new CatalogScope(firmId, branchId), context.RequestAborted);
        return Results.Ok(result);
    });

app.MapPost("/api/v1/firms/{firmId}/catalog/categories",
    async (string firmId, CreateCatalogCategory command, HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanManage || !DemoAccess.CanReadCatalog(actor, firmId, null))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Firma genelinde kategori yönetme izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var result = await services.GetRequiredService<CatalogCategoryCommands>().CreateAsync(
            firmId, command, actor.Name, context.RequestAborted);
        if (result.Failure is { } failure)
            return Failure(context, failure.Code, failure.Status, failure.Message);
        return result.Created
            ? Results.Created($"/api/v1/firms/{firmId}/catalog/categories/{result.Category!.Id}", result.Category)
            : Results.Ok(result.Category);
    });

app.MapPut("/api/v1/firms/{firmId}/catalog/categories/{categoryId}",
    async (string firmId, string categoryId, RenameCatalogCategory command,
        HttpContext context, IServiceProvider services) =>
    {
        var actor = DemoAccess.Resolve(context);
        if (actor is null) return Failure(context, "UNAUTHENTICATED", 401, "Örnek kullanıcı belirtilmedi.");
        if (!actor.CanManage || !DemoAccess.CanReadCatalog(actor, firmId, null))
            return Failure(context, "UNAUTHORIZED_SCOPE", 403, "Firma genelinde kategori yönetme izni yok.");
        if (!catalogReady)
            return Failure(context, "CATALOG_STORAGE_UNAVAILABLE", 503, "Katalog migration'ı uygulanmalı ve API yeniden başlatılmalı.");
        var result = await services.GetRequiredService<CatalogCategoryCommands>().RenameAsync(
            firmId, categoryId, command, actor.Name, context.RequestAborted);
        return result.Failure is { } failure
            ? Failure(context, failure.Code, failure.Status, failure.Message)
            : Results.Ok(result.Category);
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
        if (actor.CanOperate || !DemoAccess.CanReadCatalog(actor, firmId, branchId))
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
        var result = await services.GetRequiredService<SalesOrders>().CreateAsync(
            firmId, branchId, command, actor.Name, context.RequestAborted);
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
