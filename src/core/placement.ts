// SPDX-License-Identifier: GPL-3.0-only
//! Where the halves go around the clock.

/// The order of a top-bar box's `children` with the two halves around the
/// clock: the left half just before it, the right half just after, and
/// everything else where it was. Halves found elsewhere in the box, or not
/// in it yet, are moved in; anything another extension put between a half
/// and the clock ends up outside the pair. With no clock in the box, the
/// halves go together at its end, as one picture.
export function flankClock<T>(children: readonly T[], clock: T, left: T, right: T): T[] {
    const others = children.filter((child) => child !== left && child !== right);
    const at = others.indexOf(clock);
    if (at < 0) {
        return [...others, left, right];
    }
    return [...others.slice(0, at), left, clock, right, ...others.slice(at + 1)];
}

/// Whether the halves already sit right around the clock in `children`.
export function flanksClock<T>(children: readonly T[], clock: T, left: T, right: T): boolean {
    const at = children.indexOf(clock);
    return at > 0 && children[at - 1] === left && children[at + 1] === right;
}
