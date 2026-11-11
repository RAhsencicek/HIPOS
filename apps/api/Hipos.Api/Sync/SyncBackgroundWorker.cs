namespace Hipos.Api.Sync;

/// <summary>
/// Yerel LAN sunucusu modunda (HIPOS_CLOUD_SYNC_URL tanımlıyken) bekleyen outbox olaylarını
/// otomatik olarak merkeze aktarır ve bulut erişilebilirliğini periyodik kontrol eder.
/// </summary>
public sealed class SyncBackgroundWorker(
    SyncCoordinator coordinator,
    IServiceScopeFactory scopeFactory,
    ILogger<SyncBackgroundWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!coordinator.IsLanHub)
        {
            return;
        }

        logger.LogInformation("HIPOS Yerel LAN Hub sync işçisi başlatıldı. Hedef bulut: {CloudUrl}", coordinator.CloudUpstreamUrl);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var syncService = scope.ServiceProvider.GetRequiredService<SyncService>();
                if (syncService.IsReady)
                {
                    await syncService.FlushOutboxAsync(cancellationToken: stoppingToken);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "LAN Hub otomatik senkronizasyon turunda hata oluştu.");
            }

            await coordinator.WaitForSignalAsync(TimeSpan.FromSeconds(10), stoppingToken);
        }
    }
}
