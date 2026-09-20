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
    public DbSet<PublicFoodProduct> PublicFoodProducts => Set<PublicFoodProduct>();
    public DbSet<Weight> Weights => Set<Weight>();
    public DbSet<DayStatus> Days => Set<DayStatus>();
    public DbSet<AcceptedPlan> Plans => Set<AcceptedPlan>();
    public DbSet<CheckInDecision> CheckIns => Set<CheckInDecision>();
    public DbSet<PhaseDecision> PhaseDecisions => Set<PhaseDecision>();
    public DbSet<MutationReceipt> Receipts => Set<MutationReceipt>();
    public DbSet<ScanJob> Scans => Set<ScanJob>();
    public DbSet<AiUsage> Usage => Set<AiUsage>();
    public DbSet<PhysiquePhoto> Photos => Set<PhysiquePhoto>();
    public DbSet<PhotoObjectDeletion> PhotoObjectDeletions => Set<PhotoObjectDeletion>();
    public DbSet<BodyRecord> BodyRecords => Set<BodyRecord>();
    public DbSet<DailyExpenditureEstimate> ExpenditureEstimates => Set<DailyExpenditureEstimate>();
    public DbSet<GoogleHealthConnection> GoogleHealthConnections => Set<GoogleHealthConnection>();
    public DbSet<GoogleHealthOAuthState> GoogleHealthOAuthStates => Set<GoogleHealthOAuthState>();
    public DbSet<GoogleHealthWeightSyncWork> GoogleHealthWeightSyncWork => Set<GoogleHealthWeightSyncWork>();
    public DbSet<GoogleHealthNutritionSyncWork> GoogleHealthNutritionSyncWork => Set<GoogleHealthNutritionSyncWork>();
    public DbSet<GoogleHealthBodyFatSyncWork> GoogleHealthBodyFatSyncWork => Set<GoogleHealthBodyFatSyncWork>();
    public DbSet<IntegrationGrant> IntegrationGrants => Set<IntegrationGrant>();
    public DbSet<WorkoutSummaryCache> WorkoutSummaries => Set<WorkoutSummaryCache>();

    protected override void OnModelCreating(ModelBuilder m)
    {
        m.Entity<AppUser>().HasIndex(x => x.IdentitySubject).IsUnique();
        m.Entity<AppUser>().Property(x => x.DisplayName).HasMaxLength(120);
        m.Entity<AppUser>().Property(x => x.CheckInWeekday).HasDefaultValue(1);
        m.Entity<AppUser>().Property(x => x.MissingDayAction).HasDefaultValue("ask");
        m.Entity<AppUser>().Property(x => x.WeightGoalMetric).HasDefaultValue("scale");
        m.Entity<Food>().Property(x => x.PortionsJson).HasDefaultValue("[]");
        m.Entity<PublicFoodProduct>().HasKey(x => x.Code);
        m.Entity<PublicFoodProduct>().HasIndex(x => x.ExpiresAt);
        m.Entity<Session>().HasKey(x => x.Hash);
        m.Entity<Session>().HasIndex(x => x.Expires);
        m.Entity<MutationReceipt>().HasKey(x => new { x.UserId, x.Id });
        m.Entity<MutationReceipt>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<AiUsage>().HasKey(x => new { x.UserId, x.Date });
        m.Entity<AiUsage>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<DailyExpenditureEstimate>().HasKey(x => new { x.UserId, x.Date });
        m.Entity<DailyExpenditureEstimate>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<GoogleHealthConnection>().HasKey(x => x.UserId);
        m.Entity<GoogleHealthConnection>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<GoogleHealthConnection>().HasIndex(x => x.GoogleIdHash).IsUnique();
        m.Entity<GoogleHealthConnection>().Property(x => x.Revision).IsConcurrencyToken();
        m.Entity<GoogleHealthOAuthState>().HasKey(x => x.State);
        m.Entity<GoogleHealthOAuthState>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<GoogleHealthOAuthState>().HasIndex(x => x.ExpiresAt);
        m.Entity<GoogleHealthWeightSyncWork>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<GoogleHealthWeightSyncWork>().HasIndex(x => new { x.UserId, x.WeightId }).IsUnique();
        m.Entity<GoogleHealthWeightSyncWork>().HasIndex(x => new { x.ProcessingState, x.NextAttemptAt });
        m.Entity<GoogleHealthNutritionSyncWork>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<GoogleHealthNutritionSyncWork>().HasIndex(x => new { x.UserId, x.EntryId }).IsUnique();
        m.Entity<GoogleHealthNutritionSyncWork>().HasIndex(x => new { x.ProcessingState, x.NextAttemptAt });
        m.Entity<GoogleHealthBodyFatSyncWork>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<GoogleHealthBodyFatSyncWork>().HasIndex(x => new { x.UserId, x.BodyRecordId }).IsUnique();
        m.Entity<GoogleHealthBodyFatSyncWork>().HasIndex(x => new { x.ProcessingState, x.NextAttemptAt });
        // Deleting an account must take its sessions, idempotency receipts, and usage counters with it.
        OwnedByUser<Session>(m); OwnedByUser<MutationReceipt>(m); OwnedByUser<AiUsage>(m); OwnedByUser<DailyExpenditureEstimate>(m);
        OwnedByUser<GoogleHealthConnection>(m); OwnedByUser<GoogleHealthOAuthState>(m); OwnedByUser<GoogleHealthWeightSyncWork>(m);
        OwnedByUser<GoogleHealthNutritionSyncWork>(m); OwnedByUser<GoogleHealthBodyFatSyncWork>(m);
        Configure<IntegrationGrant>(m); Configure<WorkoutSummaryCache>(m);
        m.Entity<IntegrationGrant>().HasIndex(x => new { x.UserId, x.Peer }).IsUnique();
        m.Entity<WorkoutSummaryCache>().HasIndex(x => x.UserId).IsUnique();
        Configure<DiaryEntry>(m); Configure<Food>(m); Configure<Weight>(m); Configure<GoogleHealthWeightSyncWork>(m);
        Configure<GoogleHealthNutritionSyncWork>(m); Configure<GoogleHealthBodyFatSyncWork>(m);
        Configure<DayStatus>(m); Configure<AcceptedPlan>(m); Configure<CheckInDecision>(m); Configure<PhaseDecision>(m); Configure<ScanJob>(m);
        Configure<PhysiquePhoto>(m); Configure<PhotoObjectDeletion>(m);
        m.Entity<PhotoObjectDeletion>().HasIndex(x => new { x.Status, x.NextAttemptAt, x.Id });
        Configure<BodyRecord>(m);
        m.Entity<BodyRecord>().HasIndex(x=>new {x.UserId,x.Deleted,x.Date,x.CreationOrder});
        m.Entity<BodyRecord>().HasIndex(x=>new {x.UserId,x.Deleted,x.DeletedAt,x.Id});
        m.Entity<BodyRecord>().HasIndex(x=>new {x.UserId,x.CreationOrder}).IsUnique();
        m.Entity<BodyRecord>().OwnsOne(x=>x.Measurements, owned=>
        {
            foreach(var field in typeof(BodyMeasurements).GetProperties())
                owned.Property(field.Name).HasColumnName(field.Name);
        });
        m.Entity<BodyRecord>().Navigation(x=>x.Measurements).IsRequired();
        // SetId remains a compatibility relationship by identity only: legacy photo sets
        // predate BodyRecord rows, so a database FK would reject their migration and
        // account deletion. The service enforces the account-owned association.
        m.Entity<PhysiquePhoto>().HasIndex(x=>new { x.UserId,x.Date });
        m.Entity<PhysiquePhoto>().HasIndex(x=>new { x.UserId,x.SetId });
        m.Entity<MutationReceipt>().HasIndex(x=>x.Created);
        m.Entity<DiaryEntry>().HasIndex(x => new { x.UserId, x.Date });
        m.Entity<Food>().HasIndex(x => new { x.UserId, x.Barcode, x.Deleted });
        m.Entity<Food>().HasIndex(x => new { x.UserId, x.Deleted, x.DeletedAt, x.Id });
        m.Entity<Weight>().HasIndex(x => new { x.UserId, x.Date }).IsUnique();
        m.Entity<DayStatus>().HasIndex(x => new { x.UserId, x.Date }).IsUnique();
        m.Entity<AcceptedPlan>().HasIndex(x => new { x.UserId, x.Date });
        m.Entity<AcceptedPlan>().Property(x => x.CheckInWeekday).HasDefaultValue(1);
        m.Entity<CheckInDecision>().HasIndex(x => new { x.UserId, x.WeekStart });
        m.Entity<CheckInDecision>().Property(x => x.CheckInWeekday).HasDefaultValue(1);
        m.Entity<PhaseDecision>().HasIndex(x => new { x.UserId, x.ProfileRevision }).IsUnique();
        m.Entity<ScanJob>().HasIndex(x => x.Created);
        m.Entity<DailyExpenditureEstimate>().HasIndex(x => new { x.UserId, x.Date });
        m.Entity<DailyExpenditureEstimate>().HasIndex(x => new { x.UserId, x.SourceRevision });
        m.Entity<DailyExpenditureEstimate>().ToTable("DailyExpenditureEstimates", table =>
        {
            table.HasCheckConstraint("CK_DailyExpenditureEstimates_Confidence", "\"Confidence\" >= 0 AND \"Confidence\" <= 1");
            table.HasCheckConstraint("CK_DailyExpenditureEstimates_Expenditure", "\"Expenditure\" IS NULL OR \"Expenditure\" >= 0");
            table.HasCheckConstraint("CK_DailyExpenditureEstimates_SuggestedCalories", "\"SuggestedCalories\" IS NULL OR \"SuggestedCalories\" >= 0");
        });
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
        foreach(var entry in ChangeTracker.Entries<DailyExpenditureEstimate>().Where(e=>e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
            if(!MaintenanceAccess&&entry.Entity.UserId!=CurrentUser) throw new InvalidOperationException("Trajectory ownership violation.");
        foreach(var entry in ChangeTracker.Entries<GoogleHealthConnection>().Where(e=>e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
            if(!MaintenanceAccess&&entry.Entity.UserId!=CurrentUser) throw new InvalidOperationException("Google Health connection ownership violation.");
        foreach(var entry in ChangeTracker.Entries<GoogleHealthOAuthState>().Where(e=>e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
            if(!MaintenanceAccess&&entry.Entity.UserId!=CurrentUser) throw new InvalidOperationException("OAuth state ownership violation.");
        foreach(var entry in ChangeTracker.Entries<GoogleHealthWeightSyncWork>().Where(e=>e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
            if(!MaintenanceAccess&&entry.Entity.UserId!=CurrentUser) throw new InvalidOperationException("Google Health weight work ownership violation.");
        return base.SaveChangesAsync(cancellationToken);
    }
}
