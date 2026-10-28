namespace Hipos.Api.Kitchen;

// Hazırlık durumu satışın veya adisyonun durumundan bağımsızdır.
public sealed class KitchenTask
{
    public Guid Id { get; private set; }
    public string FirmId { get; private set; } = "";
    public string BranchId { get; private set; } = "";
    public Guid OrderId { get; private set; }
    public long OrderLineId { get; private set; }
    public Guid? StationId { get; private set; }
    public string ProductName { get; private set; } = "";
    public int Quantity { get; private set; }
    public string? Notes { get; private set; }
    public string Status { get; private set; } = "submitted";
    public int Version { get; private set; } = 1;
    public DateTimeOffset SubmittedAt { get; private set; }
    public DateTimeOffset? PreparedAt { get; private set; }
    public DateTimeOffset? ReadyAt { get; private set; }
    public DateTimeOffset? ServedAt { get; private set; }
    public DateTimeOffset? CancelledAt { get; private set; }
    public string? CancellationReason { get; private set; }
    public string? CancelledBy { get; private set; }

    private KitchenTask() { }

    public KitchenTask(Guid id, string firmId, string branchId, Guid orderId,
        long orderLineId, string productName, int quantity, DateTimeOffset submittedAt, string? notes = null)
    {
        if (id == Guid.Empty || orderId == Guid.Empty || orderLineId <= 0)
            throw new ArgumentException("Görev, sipariş ve sipariş kalemi kimlikleri geçerli olmalı.");
        if (string.IsNullOrWhiteSpace(firmId) || string.IsNullOrWhiteSpace(branchId)
            || string.IsNullOrWhiteSpace(productName) || quantity <= 0)
            throw new ArgumentException("Firma, şube, ürün ve pozitif miktar gerekli.");
        Id = id;
        FirmId = firmId;
        BranchId = branchId;
        OrderId = orderId;
        OrderLineId = orderLineId;
        ProductName = productName;
        Quantity = quantity;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        if (Notes?.Length > 500) throw new ArgumentException("Sipariş notu en çok 500 karakter olabilir.");
        SubmittedAt = submittedAt.ToUniversalTime();
    }

    // Zamanı çağıran sunucu sağlar; cihazın gönderdiği saate güvenilmez.
    public void ChangeStatus(string nextStatus, int expectedVersion, DateTimeOffset occurredAt)
    {
        if (expectedVersion != Version)
            throw new InvalidOperationException("VERSION_CONFLICT");
        if (nextStatus == Status) return;
        var allowed = (Status, nextStatus) switch
        {
            ("submitted", "preparing") or ("preparing", "ready") or ("ready", "served") => true,
            _ => false,
        };
        if (!allowed) throw new InvalidOperationException("INVALID_KITCHEN_STATUS_TRANSITION");
        var timestamp = occurredAt.ToUniversalTime();
        var previousTime = ServedAt ?? ReadyAt ?? PreparedAt ?? SubmittedAt;
        if (timestamp < previousTime)
            throw new ArgumentException("İşlem zamanı önceki durum zamanından önce olamaz.");
        Status = nextStatus;
        Version++;
        if (nextStatus == "preparing") PreparedAt = timestamp;
        if (nextStatus == "ready") ReadyAt = timestamp;
        if (nextStatus == "served") ServedAt = timestamp;
    }

    // İptalin sahibi satış/adisyon modülüdür; mutfak yalnız sonucu ve gerekçeyi saklar.
    public void CancelFromSales(string reason, string actor, int expectedVersion, DateTimeOffset occurredAt)
    {
        if (expectedVersion != Version) throw new InvalidOperationException("VERSION_CONFLICT");
        if (Status is "served" or "cancelled")
            throw new InvalidOperationException("INVALID_KITCHEN_CANCELLATION");
        if (string.IsNullOrWhiteSpace(reason) || string.IsNullOrWhiteSpace(actor))
            throw new ArgumentException("İptal gerekçesi ve işlemi yapan kişi gerekli.");
        var timestamp = occurredAt.ToUniversalTime();
        var previousTime = ReadyAt ?? PreparedAt ?? SubmittedAt;
        if (timestamp < previousTime)
            throw new ArgumentException("İptal zamanı önceki durum zamanından önce olamaz.");
        Status = "cancelled";
        Version++;
        CancelledAt = timestamp;
        CancellationReason = reason.Trim();
        CancelledBy = actor.Trim();
    }
}
