// The last time the deploy server refused a hunt for lack of room (memory, ports, hunts or CPU).
// Matchmaking writes it; the launch queue reads it. No imports, so neither side forms a cycle.
let LastRefusal = 0;

export function NoteCapacityRefusal(At = Date.now()) {
    LastRefusal = Math.max(LastRefusal, At);
}

export function LastCapacityRefusal() {
    return LastRefusal;
}

export function ResetCapacitySignal() {
    LastRefusal = 0;
}
