package dev.kidsdash.frame;

import java.time.ZoneId;
import java.time.ZonedDateTime;

/** Plain-JVM tests: `node build.mjs --test`. */
public final class SleepScheduleTest {
    private static final ZoneId NYC = ZoneId.of("America/New_York");
    private static int passed;

    public static void main(String[] args) {
        SleepSchedule night = new SleepSchedule("20:00", "06:00", "America/New_York");
        check("awake just before bed", !night.isAsleep(at(2026, 11, 16, 19, 59)));
        check("asleep at bedtime", night.isAsleep(at(2026, 11, 16, 20, 0)));
        check("asleep after midnight", night.isAsleep(at(2026, 11, 17, 3, 0)));
        check("awake at wake-up time", !night.isAsleep(at(2026, 11, 17, 6, 0)));
        check("reads instants in the family's zone",
                night.isAsleep(ZonedDateTime.of(2026, 11, 17, 2, 0, 0, 0, ZoneId.of("UTC"))));

        check("next change in the evening is bedtime",
                night.nextChange(at(2026, 11, 16, 15, 0)).equals(at(2026, 11, 16, 20, 0)));
        check("next change at night is tomorrow's wake-up",
                night.nextChange(at(2026, 11, 16, 20, 0)).equals(at(2026, 11, 17, 6, 0)));
        check("next change before dawn is the same morning",
                night.nextChange(at(2026, 11, 17, 1, 0)).equals(at(2026, 11, 17, 6, 0)));

        SleepSchedule nap = new SleepSchedule("13:00", "14:30", "America/New_York");
        check("same-day window", nap.isAsleep(at(2026, 11, 16, 14, 0)) && !nap.isAsleep(at(2026, 11, 16, 14, 30)));
        check("same-day next change rolls to tomorrow",
                nap.nextChange(at(2026, 11, 16, 15, 0)).equals(at(2026, 11, 17, 13, 0)));

        check("spring-forward wake-up is still found",
                new SleepSchedule("01:00", "02:30", "America/New_York")
                        .nextChange(at(2027, 3, 14, 1, 30)).getHour() == 3);

        rejects("an empty window", "20:00", "20:00", "America/New_York");
        rejects("a bad time", "8pm", "06:00", "America/New_York");
        rejects("a bad zone", "20:00", "06:00", "Mars/Olympus");
        System.out.println("SleepScheduleTest: " + passed + " passed");
    }

    private static ZonedDateTime at(int y, int mo, int d, int h, int mi) {
        return ZonedDateTime.of(y, mo, d, h, mi, 0, 0, NYC);
    }

    private static void rejects(String what, String start, String end, String zone) {
        try {
            new SleepSchedule(start, end, zone);
        } catch (RuntimeException expected) {
            passed++;
            return;
        }
        throw new AssertionError("should reject " + what);
    }

    private static void check(String what, boolean ok) {
        if (!ok) throw new AssertionError(what);
        passed++;
    }
}
