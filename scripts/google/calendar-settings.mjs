/** Generic descriptions for calendars created by setup-calendars.mjs. */
export function calendarDescription(kid) {
  return kid
    ? `What ${kid.name} sees on the dashboard. First line of a description is shown; "kids: special" pins an event.`
    : "Shows in every kid's column on the dashboard.";
}

/** Updating calendar IDs must preserve the family's other settings. */
export function calendarSettings(settings, calendars) {
  return {
    ...settings,
    kids: settings.kids.map(({ photo: _photo, ...kid }) => ({
      ...kid,
      calendarId: calendars.find((entry) => entry.kid?.id === kid.id).id,
    })),
    sharedCalendarIds: [calendars.find((entry) => !entry.kid).id],
  };
}
