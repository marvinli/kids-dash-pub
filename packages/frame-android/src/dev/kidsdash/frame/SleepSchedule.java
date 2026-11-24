package dev.kidsdash.frame;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/**
 * The bundle's screen-off window, in the family's timezone. `end` before
 * `start` crosses midnight; `end` is exclusive. Pure java.time so it is tested
 * on the plain JVM (test/SleepScheduleTest.java).
 */
final class SleepSchedule {
    final LocalTime start;
    final LocalTime end;
    final ZoneId zone;

    /** Throws (DateTimeException, IllegalArgumentException) on bad input. */
    SleepSchedule(String start, String end, String zone) {
        this.start = LocalTime.parse(start);
        this.end = LocalTime.parse(end);
        this.zone = ZoneId.of(zone);
        if (this.start.equals(this.end)) throw new IllegalArgumentException("empty sleep window");
    }

    boolean isAsleep(ZonedDateTime now) {
        LocalTime t = now.withZoneSameInstant(zone).toLocalTime();
        return start.isBefore(end)
                ? !t.isBefore(start) && t.isBefore(end)
                : !t.isBefore(start) || t.isBefore(end);
    }

    /** The next instant after `now` when the screen should switch off or on. */
    ZonedDateTime nextChange(ZonedDateTime now) {
        ZonedDateTime local = now.withZoneSameInstant(zone);
        ZonedDateTime best = null;
        for (int day = 0; day <= 1; day++) {
            LocalDate date = local.toLocalDate().plusDays(day);
            for (LocalTime time : new LocalTime[] {start, end}) {
                ZonedDateTime candidate = ZonedDateTime.of(date, time, zone);
                if (candidate.isAfter(local) && (best == null || candidate.isBefore(best))) best = candidate;
            }
        }
        return best;
    }
}
