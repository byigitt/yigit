//! Intercept OSC 10/11/12 color queries on the PTY read path and answer them
//! ourselves. Without this, xterm.js auto-responds via its onData callback,
//! pushing the response into the PTY's input buffer. If the querying app
//! (often a TUI like nvim) dies before reading it, the shell consumes the
//! response as keyboard input and the `rgb:...` payload leaks onto the
//! prompt. By replying here, the response races back into the PTY ahead of
//! any app teardown and the leak never happens.

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_START: u8 = b']';
const STRING_TERM: u8 = b'\\';

// Canned responses sized for Terax's default dark theme. Apps that query OSC
// 10/11/12 mostly use the answer to pick a light-vs-dark backdrop; tracking
// the live theme here would require an IPC round-trip per query and isn't
// worth the complexity for a "did the bg luminance flip?" signal.
const FG_REPLY: &[u8] = b"\x1b]10;rgb:e0e0/e0e0/e0e0\x07";
const BG_REPLY: &[u8] = b"\x1b]11;rgb:1414/1919/1c1c\x07";
const CURSOR_REPLY: &[u8] = b"\x1b]12;rgb:e0e0/e0e0/e0e0\x07";

// Cap on bytes held while we wait for an OSC terminator. Real color queries
// are at most 8 bytes (`\x1b]NN;?\x07`); anything longer is some other OSC
// (clipboard, hyperlinks, …) and we flush the prefix back into `out` so
// xterm gets the full sequence as a stream.
const HOLD_MAX: usize = 16;

#[derive(Clone, Copy)]
enum State {
    Idle,
    AfterEsc,
    InsideOsc,
    InsideOscEsc,
}

pub struct OscColorFilter {
    state: State,
    hold: Vec<u8>,
}

impl OscColorFilter {
    pub fn new() -> Self {
        OscColorFilter {
            state: State::Idle,
            hold: Vec::with_capacity(HOLD_MAX),
        }
    }

    pub fn process<F: FnMut(&[u8])>(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        mut respond: F,
    ) {
        if matches!(self.state, State::Idle) && !input.contains(&ESC) {
            out.extend_from_slice(input);
            return;
        }

        for &b in input {
            match self.state {
                State::Idle => {
                    if b == ESC {
                        self.state = State::AfterEsc;
                        self.hold.clear();
                        self.hold.push(b);
                    } else {
                        out.push(b);
                    }
                }
                State::AfterEsc => {
                    if b == OSC_START {
                        self.state = State::InsideOsc;
                        self.hold.push(b);
                    } else if b == ESC {
                        // Two ESCs back-to-back: emit the first, restart on
                        // the second.
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.hold.push(b);
                    } else {
                        out.extend_from_slice(&self.hold);
                        out.push(b);
                        self.hold.clear();
                        self.state = State::Idle;
                    }
                }
                State::InsideOsc => {
                    if b == BEL {
                        self.finalize(out, &mut respond, /*include_st*/ false);
                    } else if b == ESC {
                        self.hold.push(b);
                        self.state = State::InsideOscEsc;
                    } else {
                        self.hold.push(b);
                        if self.hold.len() > HOLD_MAX {
                            out.extend_from_slice(&self.hold);
                            self.hold.clear();
                            self.state = State::Idle;
                        }
                    }
                }
                State::InsideOscEsc => {
                    if b == STRING_TERM {
                        self.hold.push(b);
                        self.finalize(out, &mut respond, /*include_st*/ true);
                    } else {
                        // Stray ESC inside OSC body: flush what we have and
                        // restart from this byte (might be the start of a
                        // new sequence).
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        if b == ESC {
                            self.state = State::AfterEsc;
                            self.hold.push(b);
                        } else {
                            out.push(b);
                            self.state = State::Idle;
                        }
                    }
                }
            }
        }
    }

    fn finalize<F: FnMut(&[u8])>(
        &mut self,
        out: &mut Vec<u8>,
        respond: &mut F,
        include_st: bool,
    ) {
        // hold = "\x1b] body [\x1b\\]" — strip the leading \x1b] and the
        // trailing ESC \ if present (BEL has none, it terminated before push).
        let body_start = 2;
        let body_end = if include_st {
            self.hold.len() - 2
        } else {
            self.hold.len()
        };
        let body = &self.hold[body_start..body_end];

        let reply = match body {
            b"10;?" => Some(FG_REPLY),
            b"11;?" => Some(BG_REPLY),
            b"12;?" => Some(CURSOR_REPLY),
            _ => None,
        };

        match reply {
            Some(r) => respond(r),
            None => {
                // Not a color query — pass through unchanged. If the OSC was
                // terminated by BEL we need to re-emit it since we ate the
                // BEL on the way in.
                out.extend_from_slice(&self.hold);
                if !include_st {
                    out.push(BEL);
                }
            }
        }

        self.hold.clear();
        self.state = State::Idle;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(filter: &mut OscColorFilter, input: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
        let mut out = Vec::new();
        let mut replies = Vec::new();
        filter.process(input, &mut out, |r| replies.push(r.to_vec()));
        (out, replies)
    }

    #[test]
    fn osc11_bel_terminated() {
        let mut f = OscColorFilter::new();
        let (out, replies) = run(&mut f, b"\x1b]11;?\x07");
        assert!(out.is_empty());
        assert_eq!(replies, vec![BG_REPLY.to_vec()]);
    }

    #[test]
    fn osc11_st_terminated() {
        let mut f = OscColorFilter::new();
        let (out, replies) = run(&mut f, b"\x1b]11;?\x1b\\");
        assert!(out.is_empty());
        assert_eq!(replies, vec![BG_REPLY.to_vec()]);
    }

    #[test]
    fn osc10_and_12_replies() {
        let mut f = OscColorFilter::new();
        let (out1, r1) = run(&mut f, b"\x1b]10;?\x07");
        let (out2, r2) = run(&mut f, b"\x1b]12;?\x07");
        assert!(out1.is_empty());
        assert!(out2.is_empty());
        assert_eq!(r1, vec![FG_REPLY.to_vec()]);
        assert_eq!(r2, vec![CURSOR_REPLY.to_vec()]);
    }

    #[test]
    fn osc11_set_passes_through() {
        let mut f = OscColorFilter::new();
        let (out, replies) = run(&mut f, b"\x1b]11;#1c1c1c\x07");
        assert_eq!(out, b"\x1b]11;#1c1c1c\x07");
        assert!(replies.is_empty());
    }

    #[test]
    fn osc52_clipboard_long_passes_through() {
        let mut f = OscColorFilter::new();
        let payload = b"\x1b]52;c;aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3QgcGF5bG9hZA==\x07";
        let (out, replies) = run(&mut f, payload);
        // We should not eat any of it; the OSC code didn't match the color
        // ones so it goes through. The hold cap may split the emission but
        // every byte must reach `out`.
        assert_eq!(out.len(), payload.len());
        assert!(replies.is_empty());
    }

    #[test]
    fn plain_text_passes_through() {
        let mut f = OscColorFilter::new();
        let (out, replies) = run(&mut f, b"hello world\n");
        assert_eq!(out, b"hello world\n");
        assert!(replies.is_empty());
    }

    #[test]
    fn split_across_chunks() {
        let mut f = OscColorFilter::new();
        let (o1, r1) = run(&mut f, b"\x1b]1");
        let (o2, r2) = run(&mut f, b"1;");
        let (o3, r3) = run(&mut f, b"?\x07");
        assert!(o1.is_empty());
        assert!(o2.is_empty());
        assert!(o3.is_empty());
        assert!(r1.is_empty());
        assert!(r2.is_empty());
        assert_eq!(r3, vec![BG_REPLY.to_vec()]);
    }

    #[test]
    fn escape_then_non_osc_passes_through() {
        let mut f = OscColorFilter::new();
        let (out, replies) = run(&mut f, b"\x1bM");
        assert_eq!(out, b"\x1bM");
        assert!(replies.is_empty());
    }

    #[test]
    fn surrounded_query_preserves_context() {
        let mut f = OscColorFilter::new();
        let (out, replies) = run(&mut f, b"pre\x1b]11;?\x07post");
        assert_eq!(out, b"prepost");
        assert_eq!(replies, vec![BG_REPLY.to_vec()]);
    }

    #[test]
    fn unterminated_osc_within_cap_releases_on_overflow() {
        let mut f = OscColorFilter::new();
        let mut input = Vec::from(b"\x1b]11;".as_slice());
        input.extend(std::iter::repeat_n(b'x', HOLD_MAX));
        let (out, replies) = run(&mut f, &input);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }
}
