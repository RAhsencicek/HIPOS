using System.Diagnostics;
using System.Net.Sockets;

namespace Hipos.Api.Printing;

public sealed class PrinterTransport(ILogger<PrinterTransport> logger)
{
    private static string? _detectedUsbUri;

    public async Task<PrintResult> SendAsync(
        PrinterTargetConfig config,
        byte[] data,
        CancellationToken ct = default)
    {
        // 1. Try Network if configured as Network
        if (config.Type.Equals("Network", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                await SendToNetworkAsync(config.IpAddress, config.Port, data, ct);
                logger.LogInformation("Yazdırma başarılı (AĞ): {Name} -> {Ip}:{Port} ({Length} bayt)",
                    config.Name, config.IpAddress, config.Port, data.Length);
                return new PrintResult(true, config.Name, $"Network ({config.IpAddress}:{config.Port})");
            }
            catch (OperationCanceledException)
            {
                var msg = $"Ağ yazıcısına ({config.IpAddress}:{config.Port}) zaman aşımı (6 sn) nedeniyle ulaşılamadı. Cihaz kapalı veya IP adresi hatalı olabilir.";
                logger.LogWarning("{Message}", msg);
                if (!config.FallbackToUsb)
                {
                    return new PrintResult(false, config.Name, "Network", msg);
                }
                logger.LogInformation("USB yedek kanalına geçiliyor...");
            }
            catch (Exception ex)
            {
                var msg = $"Ağ yazıcısına ({config.IpAddress}:{config.Port}) bağlanırken hata oluştu: {ex.Message}";
                logger.LogWarning(ex, "{Message}", msg);
                if (!config.FallbackToUsb)
                {
                    return new PrintResult(false, config.Name, "Network", msg);
                }
                logger.LogInformation("USB yedek kanalına geçiliyor...");
            }
        }

        // 2. Try USB (directly or as fallback)
        if (OperatingSystem.IsMacOS() || OperatingSystem.IsLinux())
        {
            try
            {
                var usbSuccess = await SendToCupsUsbAsync(data, ct);
                if (usbSuccess)
                {
                    logger.LogInformation("Yazdırma başarılı (USB): {Name} ({Length} bayt)", config.Name, data.Length);
                    return new PrintResult(true, config.Name, "USB (Gprinter/KodPOS)");
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "USB yazdırma başarısız.");
            }
        }

        // 3. Fallback / Simulation Console
        logger.LogInformation("[SİMÜLE YAZICI] {Name} için {Length} bayt ESC/POS verisi hazırlandı (Yazıcı bağlı değilse simülasyon).",
            config.Name, data.Length);
        return new PrintResult(true, config.Name, "Console / Virtual", "Fiziksel aygıta ulaşılamadı, konsola simüle edildi.");
    }

    private async Task SendToNetworkAsync(string ip, int port, byte[] data, CancellationToken ct)
    {
        Exception? lastException = null;
        for (int attempt = 1; attempt <= 2; attempt++)
        {
            try
            {
                using var client = new TcpClient();
                int timeoutSec = 2;
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(timeoutSec));

                await client.ConnectAsync(ip, port, cts.Token);
                using var stream = client.GetStream();
                await stream.WriteAsync(data, ct);
                await stream.FlushAsync(ct);
                return; // Başarılı
            }
            catch (Exception ex) when (attempt == 1 && !ct.IsCancellationRequested)
            {
                lastException = ex;
                logger.LogInformation("Ağ yazıcısı ({Ip}:{Port}) uyku modunda olabilir, uyandırma ardından tekrar deneniyor...",
                    ip, port);
                await Task.Delay(300, ct);
            }
            catch (Exception ex)
            {
                lastException = ex;
            }
        }

        if (lastException is not null)
        {
            throw lastException;
        }
    }

    private async Task<bool> SendToCupsUsbAsync(byte[] data, CancellationToken ct)
    {
        if (!OperatingSystem.IsMacOS()) return false;

        var usbBackend = "/usr/libexec/cups/backend/usb";
        if (!File.Exists(usbBackend)) return false;

        // Auto-detect USB URI if not cached
        if (string.IsNullOrEmpty(_detectedUsbUri))
        {
            var detectProc = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = usbBackend,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false
                }
            };
            detectProc.Start();
            var output = await detectProc.StandardOutput.ReadToEndAsync(ct);
            await detectProc.WaitForExitAsync(ct);

            // Look for direct usb:// line
            foreach (var line in output.Split('\n'))
            {
                if (line.StartsWith("direct usb://", StringComparison.OrdinalIgnoreCase))
                {
                    var parts = line.Split(' ');
                    if (parts.Length > 1)
                    {
                        _detectedUsbUri = parts[1]; // e.g. usb://ZHU%20HAI%20HOWBEST...
                        break;
                    }
                }
            }
        }

        if (string.IsNullOrEmpty(_detectedUsbUri))
        {
            return false;
        }

        // Write temp bin file
        var tempFile = Path.Combine(Path.GetTempPath(), $"hipos_print_{Guid.NewGuid():N}.bin");
        try
        {
            await File.WriteAllBytesAsync(tempFile, data, ct);

            var printProc = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = usbBackend,
                    Arguments = $"1 hipos print 1 \"\" \"{tempFile}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false
                }
            };
            printProc.StartInfo.Environment["DEVICE_URI"] = _detectedUsbUri;
            printProc.Start();
            await printProc.WaitForExitAsync(ct);
            return printProc.ExitCode == 0;
        }
        finally
        {
            if (File.Exists(tempFile)) File.Delete(tempFile);
        }
    }
}
