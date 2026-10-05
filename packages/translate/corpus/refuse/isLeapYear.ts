// @corpus class=refuse expect=refuse code=date
// @corpus note=the multi-argument Date constructor maps years 0..99 to 1900..1999, so isLeapYear(0) is false although year 0 is a proleptic leap year

/**
 * Whether `year` is a leap year in the Gregorian calendar, by asking the Date object whether February 29 exists.
 *
 * @param year - a calendar year
 * @returns true when February of that year has 29 days
 */
export function isLeapYear(year: number): boolean {
  return new Date(year, 1, 29).getDate() === 29;
}
