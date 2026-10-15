import { describe, expect, it } from 'vitest';
import { reminderReadiness, type ReminderCapabilities } from './reminderReadiness';

const enabled: ReminderCapabilities = { appPermission: true, channelExists: true, channelDisabled: false,
  soundConfigured: true, appSettingsAvailable: true, channelSettingsAvailable: true };
describe('reminder readiness', () => {
  it('distinguishes permission denial and disabled channels from token registration', () => {
    expect(reminderReadiness({ ...enabled, appPermission: false })).toBe('blocked');
    expect(reminderReadiness({ ...enabled, channelDisabled: true })).toBe('blocked');
  });
  it('reports silent and missing channels honestly', () => {
    expect(reminderReadiness({ ...enabled, soundConfigured: false })).toBe('available but silent');
    expect(reminderReadiness({ ...enabled, channelImportance: 2 })).toBe('available but silent');
    expect(reminderReadiness({ ...enabled, channelExists: false })).toBe('available but silent');
    expect(reminderReadiness(enabled)).toBe('enabled');
  });
  it('keeps unavailable checks distinct from blocked permission', () => {
    expect(reminderReadiness(null)).toBe('could not check');
    expect(reminderReadiness({ ...enabled, appSettingsAvailable: false, channelSettingsAvailable: false })).toBe('enabled');
  });
});
