using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace Hipos.Api.Realtime;

public sealed record RestaurantEvent(
    string Type,
    string FirmId,
    string BranchId,
    object? Data,
    DateTimeOffset Timestamp
);

public interface IRestaurantEventHub
{
    void Publish(string type, string firmId, string branchId, object? data = null);
    IAsyncEnumerable<RestaurantEvent> SubscribeAsync(string firmId, string branchId, CancellationToken cancellationToken);
}

public sealed class RestaurantEventHub : IRestaurantEventHub
{
    private sealed record Subscriber(
        Guid Id,
        string FirmId,
        string BranchId,
        Channel<RestaurantEvent> Channel
    );

    private readonly ConcurrentDictionary<Guid, Subscriber> _subscribers = new();

    public void Publish(string type, string firmId, string branchId, object? data = null)
    {
        var evt = new RestaurantEvent(
            Type: type,
            FirmId: firmId,
            BranchId: branchId,
            Data: data,
            Timestamp: DateTimeOffset.UtcNow
        );

        foreach (var sub in _subscribers.Values)
        {
            if (sub.FirmId == firmId && (sub.BranchId == branchId || sub.BranchId == "*"))
            {
                sub.Channel.Writer.TryWrite(evt);
            }
        }
    }

    public async IAsyncEnumerable<RestaurantEvent> SubscribeAsync(
        string firmId,
        string branchId,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        var channel = Channel.CreateUnbounded<RestaurantEvent>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

        var subscriber = new Subscriber(id, firmId, branchId, channel);
        _subscribers.TryAdd(id, subscriber);

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                RestaurantEvent evt;
                try
                {
                    evt = await channel.Reader.ReadAsync(cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                yield return evt;
            }
        }
        finally
        {
            _subscribers.TryRemove(id, out _);
            channel.Writer.TryComplete();
        }
    }
}
