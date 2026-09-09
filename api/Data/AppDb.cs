using Microsoft.EntityFrameworkCore;

namespace Nutrition.Api.Data;

public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public Guid? CurrentUser { get; set; }
    public bool MaintenanceAccess { get; set; }
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<DiaryEntry> Entries => Set<DiaryEntry>();
    public DbSet<Food> Foods => Set<Food>();
    public DbSet<Weight> Weights => Set<Weight>();
    public DbSet<DayStatus> Days => Set<DayStatus>();
    public DbSet<AcceptedPlan> Plans => Set<AcceptedPlan>();
    public DbSet<CheckInDecision> CheckIns => Set<CheckInDecision>();
    public DbSet<PhaseDecision> PhaseDecisions => Set<PhaseDecision>();
    public DbSet<MutationReceipt> Receipts => Set<MutationReceipt>();
    public DbSet<ScanJob> Scans => Set<ScanJob>();
    public DbSet<AiUsage> Usage => Set<AiUsage>();
    public DbSet<PhysiquePhoto> Photos => Set<PhysiquePhoto>();

    protected override void OnModelCreating(ModelBuilder m)
    {
        m.Entity<AppUser>().HasIndex(x => x.Username).IsUnique();
        m.Entity<AppUser>().HasIndex(x => x.Slot).IsUnique();
        m.Entity<AppUser>().Property(x => x.Username).HasMaxLength(80);
        m.Entity<Session>().HasKey(x => x.Hash);
        m.Entity<Session>().HasIndex(x => x.Expires);
        m.Entity<MutationReceipt>().HasKey(x => new { x.UserId, x.Id });
        m.Entity<MutationReceipt>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<AiUsage>().HasKey(x => new { x.UserId, x.Date });
        m.Entity<AiUsage>().HasQueryFilter(x => x.UserId == CurrentUser);
        // Deleting an account must take its sessions, idempotency receipts, and usage counters with it.
        OwnedByUser<Session>(m); OwnedByUser<MutationReceipt>(m); OwnedByUser<AiUsage>(m);
        Configure<DiaryEntry>(m); Configure<Food>(m); Configure<Weight>(m);
        Configure<DayStatus>(m); Configure<AcceptedPlan>(m); Configure<CheckInDecision>(m); Configure<PhaseDecision>(m); Configure<ScanJob>(m);
        Configure<PhysiquePhoto>(m);
        m.Entity<PhysiquePhoto>().HasIndex(x=>new { x.UserId,x.Date });
        m.Entity<MutationReceipt>().HasIndex(x=>x.Created);
        m.Entity<DiaryEntry>().HasIndex(x => new { x.UserId, x.Date });
        m.Entity<Weight>().HasIndex(x => new { x.UserId, x.Date }).IsUnique();
        m.Entity<DayStatus>().HasIndex(x => new { x.UserId, x.Date }).IsUnique();
        m.Entity<AcceptedPlan>().HasIndex(x => new { x.UserId, x.Date });
        m.Entity<CheckInDecision>().HasIndex(x => new { x.UserId, x.WeekStart });
        m.Entity<PhaseDecision>().HasIndex(x => new { x.UserId, x.ProfileRevision }).IsUnique();
        m.Entity<ScanJob>().HasIndex(x => x.Created);
    }
    private static void OwnedByUser<T>(ModelBuilder m) where T : class
        => m.Entity<T>().HasOne<AppUser>().WithMany().HasForeignKey("UserId").OnDelete(DeleteBehavior.Cascade);
    private void Configure<T>(ModelBuilder m) where T : OwnedRecord
    {
        m.Entity<T>().HasBaseType((Type?)null);
        m.Entity<T>().HasKey(x => new { x.UserId, x.Id });
        m.Entity<T>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<T>().Property(x => x.Revision).IsConcurrencyToken();
        OwnedByUser<T>(m);
    }
    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries<OwnedRecord>().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            if (!MaintenanceAccess && (CurrentUser == null || entry.Entity.UserId != CurrentUser))
                throw new InvalidOperationException("Record ownership violation.");
            if (entry.State != EntityState.Added && entry.Property(x => x.UserId).IsModified)
                throw new InvalidOperationException("Record ownership cannot change.");
        }
        foreach(var entry in ChangeTracker.Entries<MutationReceipt>().Where(e=>e.State is EntityState.Added or EntityState.Modified))
            if(entry.Entity.UserId!=CurrentUser) throw new InvalidOperationException("Receipt ownership violation.");
        foreach(var entry in ChangeTracker.Entries<AiUsage>().Where(e=>e.State is EntityState.Added or EntityState.Modified))
            if(!MaintenanceAccess&&entry.Entity.UserId!=CurrentUser) throw new InvalidOperationException("Usage ownership violation.");
        return base.SaveChangesAsync(cancellationToken);
    }
}
