using System.Text.Json;
using Hipos.Api.Features;

namespace Hipos.Api.Realtime;

public static class RealtimeEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static void MapRealtimeEndpoints(this WebApplication app)
    {
        app.MapGet("/api/v1/firms/{firmId}/branches/{branchId}/events/stream", async (
            string firmId,
            string branchId,
            HttpContext context,
            IRestaurantEventHub eventHub,
            CancellationToken ct) =>
        {
            var actor = DemoAccess.Resolve(context);
            if (actor is null || !actor.CanRead(firmId, branchId))
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsync("Unauthorized to stream events for this branch.", ct);
                return;
            }

            context.Response.Headers.ContentType = "text/event-stream";
            context.Response.Headers.CacheControl = "no-cache, no-transform";
            context.Response.Headers.Connection = "keep-alive";
            context.Response.Headers["X-Accel-Buffering"] = "no";

            // Bağlantı kurulduğu anda başlangıç teyit sinyali fırlat
            await SendSseEventAsync(context.Response, "connected", new
            {
                message = "HIPOS LAN Eşzamanlılık SSE Akışı Bağlandı",
                firmId,
                branchId,
                timestamp = DateTimeOffset.UtcNow
            }, ct);

            // Arka planda 15 saniyede bir kalp atışı (keep-alive ping)
            using var pingCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var pingTask = Task.Run(async () =>
            {
                while (!pingCts.Token.IsCancellationRequested)
                {
                    try
                    {
                        await Task.Delay(TimeSpan.FromSeconds(15), pingCts.Token);
                        await context.Response.WriteAsync(": ping\n\n", pingCts.Token);
                        await context.Response.Body.FlushAsync(pingCts.Token);
                    }
                    catch
                    {
                        break;
                    }
                }
            }, pingCts.Token);

            try
            {
                await foreach (var evt in eventHub.SubscribeAsync(firmId, branchId, ct))
                {
                    await SendSseEventAsync(context.Response, evt.Type, evt, ct);
                }
            }
            catch (OperationCanceledException)
            {
                // İstemci sekmesini kapattı veya bağlantıyı kesti
            }
            finally
            {
                pingCts.Cancel();
                try
                {
                    await pingTask;
                }
                catch
                {
                    // Ping görevini sessizce kapat
                }
            }
        });
    }

    private static async Task SendSseEventAsync(HttpResponse response, string eventType, object data, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(data, JsonOptions);
        await response.WriteAsync($"event: {eventType}\ndata: {json}\n\n", ct);
        await response.Body.FlushAsync(ct);
    }
}
