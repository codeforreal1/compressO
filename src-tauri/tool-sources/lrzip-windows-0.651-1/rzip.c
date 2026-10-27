/*
   Copyright (C) 2006-2016,2018,2022 Con Kolivas
   Copyright (C) 1998 Andrew Tridgell

   Modified to use flat hash, memory limit and variable hash culling
   by Rusty Russell copyright (C) 2003.

   This program is free software; you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation; either version 2 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program. If not, see <http://www.gnu.org/licenses/>.
*/
/* rzip compression algorithm */

#ifdef HAVE_CONFIG_H
# include "config.h"
#endif

#ifdef HAVE_SYS_MMAN_H
# include <sys/mman.h>
#endif
#ifdef HAVE_SYS_STAT_H
# include <sys/stat.h>
#endif
#ifdef HAVE_SYS_TIME_H
# include <sys/time.h>
#endif
#ifdef HAVE_UNISTD_H
# include <unistd.h>
#endif
#include <lzo/lzoconf.h>
#include <lzo/lzo1x.h>
#ifdef HAVE_ERRNO_H
# include <errno.h>
#endif
#ifdef HAVE_ENDIAN_H
# include <endian.h>
#elif HAVE_SYS_ENDIAN_H
# include <sys/endian.h>
#endif
#ifdef HAVE_ARPA_INET_H
# include <arpa/inet.h>
#endif
#include <inttypes.h>

#include "md5.h"
#include "stream.h"
#include "util.h"
#include "lrzip_core.h"
/* needed for CRC routines */
#include "lzma/C/7zCrc.h"

#if defined(_WIN32) || defined(_WIN64)
#include "mman.h"
#endif

#include "misc.h"

#ifndef MAP_ANONYMOUS
# define MAP_ANONYMOUS MAP_ANON
#endif

#define CHUNK_MULTIPLE (100 * 1024 * 1024)
#define CKSUM_CHUNK 1024*1024
#define GREAT_MATCH 1024
#define MINIMUM_MATCH 31

/* Hash table works as follows.  We start by throwing tags at every
 * offset into the table.  As it fills, we start eliminating tags
 * which don't have lower bits set to one (ie. first we eliminate all
 * even tags, then all tags divisible by four, etc.).  This ensures
 * that on average, all parts of the file are covered by the hash, if
 * sparsely. */

/* All zero means empty.  We might miss the first chunk this way. */
struct hash_entry {
	i64 offset;
	tag t;
};

/* Levels control hashtable size and bzip2 level. */
static struct level {
	unsigned long mb_used;
	unsigned initial_freq;
	unsigned max_chain_len;
} levels[10] = {
	{ 1, 4, 1 },
	{ 2, 4, 2 },
	{ 4, 4, 2 },
	{ 8, 4, 2 },
	{ 16, 4, 3 },
	{ 32, 4, 4 },
	{ 32, 2, 6 },
	{ 64, 1, 16 }, /* More MB makes sense, but need bigger test files */
	{ 64, 1, 32 },
	{ 64, 1, 128 },
};

static void remap_low_sb(rzip_control *control, struct sliding_buffer *sb)
{
	i64 new_offset;

	new_offset = sb->offset_search;
	round_to_page(&new_offset);
	print_maxverbose("Sliding main buffer to offset %lld\n", new_offset);
	if (unlikely(munmap(sb->buf_low, sb->size_low)))
		failure("Failed to munmap in remap_low_sb\n");
	if (new_offset + sb->size_low > sb->orig_size)
		sb->size_low = sb->orig_size - new_offset;
	sb->offset_low = new_offset;
	sb->buf_low = (uchar *)mmap(sb->buf_low, sb->size_low, PROT_READ, MAP_SHARED, sb->fd, sb->orig_offset + sb->offset_low);
	if (unlikely(sb->buf_low == MAP_FAILED))
		failure("Failed to re mmap in remap_low_sb\n");
}

static inline void remap_high_sb(rzip_control *control, struct sliding_buffer *sb, i64 p)
{
	if (unlikely(munmap(sb->buf_high, sb->size_high)))
		failure("Failed to munmap in remap_high_sb\n");
	sb->size_high = sb->high_length; /* In case we shrunk it when we hit the end of the file */
	sb->offset_high = p;
	/* Make sure offset is rounded to page size of total offset */
	sb->offset_high -= (sb->offset_high + sb->orig_offset) % control->page_size;
	if (unlikely(sb->offset_high + sb->size_high > sb->orig_size))
		sb->size_high = sb->orig_size - sb->offset_high;
	sb->buf_high = (uchar *)mmap(sb->buf_high, sb->size_high, PROT_READ, MAP_SHARED, sb->fd, sb->orig_offset + sb->offset_high);
	if (unlikely(sb->buf_high == MAP_FAILED))
		failure("Failed to re mmap in remap_high_sb\n");
}

/* We use a "sliding mmap" to effectively read more than we can fit into the
 * compression window. This is done by using a maximally sized lower mmap at
 * the beginning of the block which slides up once the hash search moves beyond
 * it, and a 64k mmap block that slides up and down as is required for any
 * offsets outside the range of the lower one. This is much slower than mmap
 * but makes it possible to have unlimited sized compression windows.
 * We use a pointer to the function we actually want to use and only enable
 * the sliding mmap version if we need sliding mmap functionality as this is
 * a hot function during the rzip phase */
static uchar *sliding_get_sb(rzip_control *control, i64 p)
{
	struct sliding_buffer *sb = &control->sb;
	i64 sbo;

	sbo = sb->offset_low;
	if (p >= sbo && p < sbo + sb->size_low)
		return (sb->buf_low + p - sbo);
	sbo = sb->offset_high;
	if (p >= sbo && p < (sbo + sb->size_high))
		return (sb->buf_high + (p - sbo));
	/* p is not within the low or high buffer range */
	remap_high_sb(control, &control->sb, p);
	/* Use sb->offset_high directly since it will have changed */
	return (sb->buf_high + (p - sb->offset_high));
}

/* The length of continous range of the sliding buffer,
 * starting from the offset P.
 */
static inline i64 sliding_get_sb_range(rzip_control *control, i64 p)
{
	struct sliding_buffer *sb = &control->sb;
	i64 sbo, sbs;

	sbo = sb->offset_low;
	sbs = sb->size_low;
	if (p >= sbo && p < sbo + sbs)
		return (sbs - (p - sbo));
	sbo = sb->offset_high;
	sbs = sb->size_high;
	if (likely(p >= sbo && p < (sbo + sbs)))
		return (sbs - (p - sbo));

	fatal_return(("sliding_get_sb_range: the pointer is out of range\n"), 0);
}

/* Since the sliding get_sb only allows us to access one byte at a time, we
 * do the same as we did with get_sb with the memcpy since one memcpy is much
 * faster than numerous memcpys 1 byte at a time */
static void single_mcpy(rzip_control *control, unsigned char *buf, i64 offset, i64 len)
{
	memcpy(buf, control->sb.buf_low + offset, len);
}

static void sliding_mcpy(rzip_control *control, unsigned char *buf, i64 offset, i64 len)
{
	i64 n = 0;

	while (n < len) {
		uchar *srcbuf = sliding_get_sb(control, offset + n);
		i64 m = MIN(sliding_get_sb_range(control, offset + n), len - n);

		memcpy(buf + n, srcbuf, m);
		n += m;
	}
}

/* All put_u8/u32/vchars go to stream 0 */
static inline void put_u8(rzip_control *control, void *ss, uchar b)
{
	write_stream(control, ss, 0, &b, 1);
}

static inline void put_u32(rzip_control *control, void *ss, uint32_t s)
{
	s = htole32(s);
	write_stream(control, ss, 0, (uchar *)&s, 4);
}

/* Put a variable length of bytes dependant on how big the chunk is */
static void put_vchars(rzip_control *control, void *ss, i64 s, i64 length)
{
	s = htole64(s);
	write_stream(control, ss, 0, (uchar *)&s, length);
}

static void put_header(rzip_control *control, void *ss, uchar head, i64 len)
{
	put_u8(control, ss, head);
	put_vchars(control, ss, len, 2);
}

static inline void put_match(rzip_control *control, struct rzip_state *st,
			     i64 p, i64 offset, i64 len)
{
	do {
		i64 ofs;
		i64 n = len;
		if (n > 0xFFFF)
			n = 0xFFFF;

		ofs = (p - offset);
		put_header(control, st->ss, 1, n);
		put_vchars(control, st->ss, ofs, st->chunk_bytes);
		st->stats.matches++;
		st->stats.match_bytes += n;
		len -= n;
		p += n;
		offset += n;
	} while (len);
}

/* write some data to a stream mmap encoded. Return -1 on failure */
static inline void write_sbstream(rzip_control *control, void *ss, int stream,
				 i64 p, i64 len)
{
	struct stream_info *sinfo = ss;

	while (len) {
		i64 n = MIN(sinfo->bufsize - sinfo->s[stream].buflen, len);

		control->do_mcpy(control, sinfo->s[stream].buf + sinfo->s[stream].buflen, p, n);

		sinfo->s[stream].buflen += n;
		p += n;
		len -= n;

		if (sinfo->s[stream].buflen == sinfo->bufsize)
			flush_buffer(control, sinfo, stream);
	}
}

static void put_literal(rzip_control *control, struct rzip_state *st, i64 last, i64 p)
{
	do {
		i64 len = p - last;

		if (len > 0xFFFF)
			len = 0xFFFF;

		st->stats.literals++;
		st->stats.literal_bytes += len;

		put_header(control, st->ss, 0, len);

		if (len)
			write_sbstream(control, st->ss, 1, last, len);
		last += len;
	} while (p > last);
}

/* Could give false positive on offset 0.  Who cares. */
static inline bool empty_hash(struct hash_entry *he)
{
	return !(he->offset | he->t);
}

static i64 primary_hash(struct rzip_state *st, tag t)
{
	return t & ((1 << st->hash_bits) - 1);
}

static inline tag increase_mask(tag tag_mask)
{
	/* Get more precise. */
	return (tag_mask << 1) | 1;
}

static inline bool minimum_bitness(struct rzip_state *st, tag t)
{
	tag better_than_min = increase_mask(st->minimum_tag_mask);

	if ((t & better_than_min) != better_than_min)
		return true;
	return false;
}

/* Is a going to be cleaned before b?  ie. does a have fewer low bits
 * set than b? */
static inline bool lesser_bitness(tag a, tag b)
{
	a ^= 0xffffffffffffffff;
	b ^= 0xffffffffffffffff;
	return (ffsll(a) < ffsll(b));
}

/* If hash bucket is taken, we spill into next bucket(s).  Secondary hashing
   works better in theory, but modern caches make this 20% faster. */
static void insert_hash(struct rzip_state *st, tag t, i64 offset)
{
	i64 h, victim_h = 0, round = 0;
	/* If we need to kill one, this will be it. */
	static i64 victim_round = 0;
	struct hash_entry *he;

	h = primary_hash(st, t);
	he = &st->hash_table[h];
	while (!empty_hash(he)) {
		/* If this due for cleaning anyway, just replace it:
		   rehashing might move it behind tag_clean_ptr. */
		if (minimum_bitness(st, he->t)) {
			st->hash_count--;
			break;
		}
		/* If we are better than current occupant, we can't
		   jump over it: it will be cleaned before us, and
		   noone would then find us in the hash table.  Rehash
		   it, then take its place. */
		if (lesser_bitness(he->t, t)) {
			insert_hash(st, he->t,
				    he->offset);
			break;
		}

		/* If we have lots of identical patterns, we end up
		   with lots of the same hash number.  Discard random. */
		if (he->t == t) {
			if (round == victim_round)
				victim_h = h;
			if (++round == st->level->max_chain_len) {
				h = victim_h;
				he = &st->hash_table[h];
				st->hash_count--;
				victim_round++;
				if (victim_round == st->level->max_chain_len)
					victim_round = 0;
				break;
			}
		}

		h++;
		h &= ((1 << st->hash_bits) - 1);
		he = &st->hash_table[h];
	}

	he->t = t;
	he->offset = offset;
}

/* Eliminate one hash entry with minimum number of lower bits set.
   Returns tag requirement for any new entries. */
static inline tag clean_one_from_hash(rzip_control *control, struct rzip_state *st)
{
	struct hash_entry *he;
	tag better_than_min;

again:
	better_than_min = increase_mask(st->minimum_tag_mask);
	if (!st->tag_clean_ptr)
		print_maxverbose("Starting sweep for mask %u\n", (unsigned int)st->minimum_tag_mask);

	for (; st->tag_clean_ptr < (1U << st->hash_bits); st->tag_clean_ptr++) {
		he = &st->hash_table[st->tag_clean_ptr];
		if (empty_hash(he))
			continue;
		if ((he->t & better_than_min) != better_than_min) {
			he->offset = 0;
			he->t = 0;
			st->hash_count--;
			return better_than_min;
		}
	}

	/* We hit the end: everthing in hash satisfies the better mask. */
	st->minimum_tag_mask = better_than_min;
	st->tag_clean_ptr = 0;
	goto again;
}

static void single_next_tag(rzip_control *control, struct rzip_state *st, i64 p, tag *t)
{
	uchar u;

	u = control->sb.buf_low[p - 1];
	*t ^= st->hash_index[u];
	u = control->sb.buf_low[p + MINIMUM_MATCH - 1];
	*t ^= st->hash_index[u];
}

static void sliding_next_tag(rzip_control *control, struct rzip_state *st, i64 p, tag *t)
{
	uchar *u;

	u = sliding_get_sb(control, p - 1);
	*t ^= st->hash_index[*u];
	u = sliding_get_sb(control, p + MINIMUM_MATCH - 1);
	*t ^= st->hash_index[*u];
}

static tag single_full_tag(rzip_control *control, struct rzip_state *st, i64 p)
{
	tag ret = 0;
	int i;
	uchar u;

	for (i = 0; i < MINIMUM_MATCH; i++) {
		u = control->sb.buf_low[p + i];
		ret ^= st->hash_index[u];
	}
	return ret;
}

static tag sliding_full_tag(rzip_control *control, struct rzip_state *st, i64 p)
{
	tag ret = 0;
	int i;
	uchar *u;

	for (i = 0; i < MINIMUM_MATCH; i++) {
		u = sliding_get_sb(control, p + i);
		ret ^= st->hash_index[*u];
	}
	return ret;
}

static i64
single_match_len(rzip_control *control, struct rzip_state *st, i64 p0, i64 op,
		 i64 end, i64 *rev)
{
	i64 p, len;

	if (op >= p0)
		return 0;

	p = p0;
	while (p < end && control->sb.buf_low[p] == control->sb.buf_low[op]) {
		p++;
		op++;
	}
	len = p - p0;
	p = p0;
	op -= len;

	end = MAX(0, st->last_match);

	while (p > end && op > 0 && control->sb.buf_low[op - 1] == control->sb.buf_low[p - 1]) {
		op--;
		p--;
	}

	len += *rev = p0 - p;
	if (len < MINIMUM_MATCH)
		return 0;

	return len;
}

static i64
sliding_match_len(rzip_control *control, struct rzip_state *st, i64 p0, i64 op,
		  i64 end, i64 *rev)
{
	i64 p, len;

	if (op >= p0)
		return 0;

	p = p0;
	while (p < end && *sliding_get_sb(control, p) == *sliding_get_sb(control, op)) {
		p++;
		op++;
	}
	len = p - p0;
	p = p0;
	op -= len;

	end = MAX(0, st->last_match);

	while (p > end && op > 0 && *sliding_get_sb(control, op - 1) == *sliding_get_sb(control, p - 1)) {
		op--;
		p--;
	}

	len += *rev = p0 - p;
	if (len < MINIMUM_MATCH)
		return 0;

	return len;
}

static inline i64
find_best_match(rzip_control *control, struct rzip_state *st, tag t, i64 p,
		i64 end, i64 *offset, i64 *reverse)
{
	struct hash_entry *he;
	i64 length = 0;
	i64 rev;
	i64 h;

	rev = 0;
	*reverse = 0;

	/* Could optimise: if lesser goodness, can stop search.  But
	 * chains are usually short anyway. */
	h = primary_hash(st, t);
	he = &st->hash_table[h];
	while (!empty_hash(he)) {
		i64 mlen;

		if (t == he->t) {
			mlen = control->match_len(control, st, p, he->offset, end,
						  &rev);
			if (mlen) {
				if (mlen > length) {
					length = mlen;
					(*offset) = he->offset - rev;
					(*reverse) = rev;
				}
				st->stats.tag_hits++;
			} else
				st->stats.tag_misses++;
		}

		h++;
		h &= ((1 << st->hash_bits) - 1);
		he = &st->hash_table[h];
	}

	return length;
}

static void show_distrib(rzip_control *control, struct rzip_state *st)
{
	struct hash_entry *he;
	i64 primary = 0;
	i64 total = 0;
	i64 i;

	for (i = 0; i < (1U << st->hash_bits); i++) {
		he = &st->hash_table[i];
		if (empty_hash(he))
			continue;
		total++;
		if (primary_hash(st, he->t) == i)
			primary++;
	}

	if (total != st->hash_count)
		print_err("WARNING: hash_count says total %lld\n", st->hash_count);

	if (!total)
		print_output("0 total hashes\n");
	else {
		print_output("%lld total hashes -- %lld in primary bucket (%-2.3f%%)\n",
			     total, primary, primary * 100.0 / total);
	}
}

/* Perform all checksumming in a separate thread to speed up the hash search. */
static void *cksumthread(void *data)
{
	rzip_control *control = (rzip_control *)data;

	pthread_detach(pthread_self());

	*control->checksum.cksum = CrcUpdate(*control->checksum.cksum, control->checksum.buf, control->checksum.len);
	if (!NO_MD5)
		md5_process_bytes(control->checksum.buf, control->checksum.len, &control->ctx);
	dealloc(control->checksum.buf);
	cksem_post(control, &control->cksumsem);
	return NULL;
}

static inline void cksum_update(rzip_control *control)
{
	pthread_t thread;

	create_pthread(control, &thread, NULL, cksumthread, control);
}

static inline void hash_search(rzip_control *control, struct rzip_state *st,
			       double pct_base, double pct_multiple)
{
	i64 cksum_limit = 0, p, end, cksum_chunks, cksum_remains, i;
	tag t = 0, tag_mask = (1 << st->level->initial_freq) - 1;
	struct sliding_buffer *sb = &control->sb;
	int lastpct = 0, last_chunkpct = 0;
	struct {
		i64 p;
		i64 ofs;
		i64 len;
	} current;

	if (st->hash_table)
		memset(st->hash_table, 0, sizeof(st->hash_table[0]) * (1<<st->hash_bits));
	else {
		i64 hashsize = st->level->mb_used *
				(1024 * 1024 / sizeof(st->hash_table[0]));
		for (st->hash_bits = 0; (1U << st->hash_bits) < hashsize; st->hash_bits++);

		print_maxverbose("hashsize = %lld.  bits = %lld. %luMB\n",
				 hashsize, st->hash_bits, st->level->mb_used);

		/* 66% full at max. */
		st->hash_limit = (1 << st->hash_bits) / 3 * 2;
		st->hash_table = calloc(sizeof(st->hash_table[0]), (1 << st->hash_bits));
		if (unlikely(!st->hash_table))
			failure("Failed to allocate hash table in hash_search\n");
	}

	st->minimum_tag_mask = tag_mask;
	st->tag_clean_ptr = 0;
	st->cksum = 0;
	st->hash_count = 0;

	p = 0;
	end = st->chunk_size - MINIMUM_MATCH;
	st->last_match = p;
	current.len = 0;
	current.p = p;
	current.ofs = 0;

	if (likely(end > 0))
		t = control->full_tag(control, st, p);

	while (p < end) {
		i64 reverse, mlen, offset;

		sb->offset_search = ++p;
		if (unlikely(sb->offset_search > sb->offset_low + sb->size_low))
			remap_low_sb(control, &control->sb);

		if (unlikely(p % 128 == 0 && st->chunk_size)) {
			i64 chunk_pct;
			int pct;

			pct = pct_base + (pct_multiple * (100.0 * p) / st->chunk_size );
			chunk_pct = p * 100 / end;
			if (pct != lastpct || chunk_pct != last_chunkpct) {
				if (!STDIN || st->stdin_eof)
					print_progress("Total: %2d%%  ", pct);
				print_progress("Chunk: %2d%%\r", chunk_pct);
				if (control->info_cb)
					control->info_cb(control->info_data,
						(!STDIN || st->stdin_eof) ? pct : -1, chunk_pct);
				lastpct = pct;
				last_chunkpct = chunk_pct;
			}
		}

		control->next_tag(control, st, p, &t);

		/* Don't look for a match if there are no tags with
		   this number of bits in the hash table. */
		if ((t & st->minimum_tag_mask) != st->minimum_tag_mask)
			continue;

		offset = 0;
		mlen = find_best_match(control, st, t, p, end, &offset, &reverse);

		/* Only insert occasionally into hash. */
		if ((t & tag_mask) == tag_mask) {
			st->stats.inserts++;
			st->hash_count++;
			insert_hash(st, t, p);
			if (st->hash_count > st->hash_limit)
				tag_mask = clean_one_from_hash(control, st);
		}

		if (mlen > current.len) {
			current.p = p - reverse;
			current.len = mlen;
			current.ofs = offset;
		}

		if ((current.len >= GREAT_MATCH || p >= current.p + MINIMUM_MATCH)
		    && current.len >= MINIMUM_MATCH) {
			if (st->last_match < current.p)
				put_literal(control, st, st->last_match, current.p);
			put_match(control, st, current.p, current.ofs, current.len);
			st->last_match = current.p + current.len;
			current.p = p = st->last_match;
			current.len = 0;
			t = control->full_tag(control, st, p);
		}

		if (p > cksum_limit) {
			/* We lock the mutex here and unlock it in the
			 * cksumthread. This lock protects all the data in
			 * control->checksum.
			 */
			cksem_wait(control, &control->cksumsem);
			control->checksum.len = MIN(st->chunk_size - p, control->page_size);
			control->checksum.buf = malloc(control->checksum.len);
			if (unlikely(!control->checksum.buf))
				failure("Failed to malloc ckbuf in hash_search\n");
			control->do_mcpy(control, control->checksum.buf, cksum_limit, control->checksum.len);
			control->checksum.cksum = &st->cksum;
			cksum_limit += control->checksum.len;
			cksum_update(control);
		}
	}

	if (MAX_VERBOSE)
		show_distrib(control, st);

	if (st->last_match < st->chunk_size)
		put_literal(control, st, st->last_match, st->chunk_size);

	if (st->chunk_size > cksum_limit) {
		i64 cksum_len = control->maxram;
		void *buf;

		while (42) {
			round_to_page(&cksum_len);
			buf = malloc(cksum_len);
			if (buf) {
				print_maxverbose("Malloced %"PRId64" for checksum ckbuf\n", cksum_len);
				break;
			}
			cksum_len = cksum_len / 3 * 2;
			if (cksum_len < control->page_size)
				failure("Failed to malloc any ram for checksum ckbuf\n");
		}

		/* Compute checksum. If the entire chunk is longer than maxram,
		 * do it "per-partes" */
		cksem_wait(control, &control->cksumsem);
		control->checksum.buf = buf;
		control->checksum.len = st->chunk_size - cksum_limit;
		cksum_chunks = control->checksum.len / cksum_len;
		cksum_remains = control->checksum.len % cksum_len;

		for (i = 0; i < cksum_chunks; i++) {
			control->do_mcpy(control, control->checksum.buf, cksum_limit, cksum_len);
			cksum_limit += cksum_len;
			st->cksum = CrcUpdate(st->cksum, control->checksum.buf, cksum_len);
			if (!NO_MD5)
				md5_process_bytes(control->checksum.buf, cksum_len, &control->ctx);
		}
		/* Process end of the checksum buffer */
		control->do_mcpy(control, control->checksum.buf, cksum_limit, cksum_remains);
		st->cksum = CrcUpdate(st->cksum, control->checksum.buf, cksum_remains);
		if (!NO_MD5)
			md5_process_bytes(control->checksum.buf, cksum_remains, &control->ctx);
		dealloc(control->checksum.buf);
		cksem_post(control, &control->cksumsem);
	} else {
		cksem_wait(control, &control->cksumsem);
		cksem_post(control, &control->cksumsem);
	}

	put_literal(control, st, 0, 0);
	put_u32(control, st->ss, st->cksum);
}


static inline void init_hash_indexes(struct rzip_state *st)
{
	for (int i = 0; i < 256; i++)
		st->hash_index[i] = get_random_32();
}

#if !defined(__linux)
# define mremap fake_mremap

static inline void *fake_mremap(void *old_address, size_t old_size, size_t new_size, int flags __UNUSED__)
{
	if (new_size > old_size) {
		fprintf(stderr, "fake_mremap: This should only be used to shrink things. I'm not bothering with this.\n");
		exit(1);
	} else {
		/* new_size occupies N pages; old_size occupies M > N pages;
		 we want to unmap the M - N pages at the end.
		 note the idiom: ceiling(n/k) = (n+k-1) div k */
		size_t kept_n = (new_size + PAGE_SIZE - 1) / PAGE_SIZE;
		int ret = munmap(old_address + (kept_n * PAGE_SIZE), old_size - (kept_n * PAGE_SIZE));

		if (ret < 0)
			return MAP_FAILED;

		return old_address;
	}
}
#endif

/* stdin is not file backed so we have to emulate the mmap by mapping
 * anonymous ram and reading stdin into it. It means the maximum ram
 * we can use will be less but we will already have determined this in
 * rzip_chunk */
static inline void mmap_stdin(rzip_control *control, uchar *buf,
			      struct rzip_state *st)
{
	i64 len = st->chunk_size;
	uchar *offset_buf = buf;
	ssize_t ret;
	i64 total;

	total = 0;
	while (len > 0) {
		ret = MIN(len, one_g);
		ret = read(fileno(control->inFILE), offset_buf, (size_t)ret);
		if (unlikely(ret < 0))
			failure("Failed to read in mmap_stdin\n");
		total += ret;
		if (ret == 0) {
			/* Should be EOF */
			print_maxverbose("Shrinking chunk to %lld\n", total);
			if (likely(total)) {
				buf = (uchar *)mremap(buf, st->chunk_size, total, 0);
				st->mmap_size = st->chunk_size = total;
			} else {
				/* Empty file */
				buf = (uchar *)mremap(buf, st->chunk_size, control->page_size, 0);
				st->mmap_size = control->page_size;
				st->chunk_size = 0;
			}
			if (unlikely(buf == MAP_FAILED))
				failure("Failed to remap to smaller buf in mmap_stdin\n");
			control->eof = st->stdin_eof = 1;
			break;
		}
		offset_buf += ret;
		len -= ret;
	}
	control->st_size += total;
}

static inline void
init_sliding_mmap(rzip_control *control, struct rzip_state *st, int fd_in,
		  i64 offset)
{
	struct sliding_buffer *sb = &control->sb;

	/* Initialise the high buffer. One page size is fastest to manipulate */
	if (!STDIN) {
		sb->high_length = control->page_size;
		sb->buf_high = (uchar *)mmap(NULL, sb->high_length, PROT_READ, MAP_SHARED, fd_in, offset);
		if (unlikely(sb->buf_high == MAP_FAILED))
			failure("Unable to mmap buf_high in init_sliding_mmap\n");
		sb->size_high = sb->high_length;
		sb->offset_high = 0;
	}
	sb->offset_low = 0;
	sb->offset_search = 0;
	sb->size_low = st->mmap_size;
	sb->orig_size = st->chunk_size;
	sb->fd = fd_in;
}

static void add_to_sslist(rzip_control *control, struct rzip_state *st)
{
	struct node *node = calloc(sizeof(struct node), 1);

	if (unlikely(!node))
		failure("Failed to calloc struct node in add_to_sslist\n");
	node->data = st->ss;
	node->prev = st->sslist;
	st->head = node;
}

/* compress a chunk of an open file. Assumes that the file is able to
   be mmap'd and is seekable */
static inline void
rzip_chunk(rzip_control *control, struct rzip_state *st, int fd_in, int fd_out,
	   i64 offset, double pct_base, double pct_multiple)
{
	struct sliding_buffer *sb = &control->sb;

	init_sliding_mmap(control, st, fd_in, offset);

	st->ss = open_stream_out(control, fd_out, NUM_STREAMS, st->chunk_size, st->chunk_bytes);
	if (unlikely(!st->ss))
		failure("Failed to open streams in rzip_chunk\n");

	print_verbose("Beginning rzip pre-processing phase\n");
	hash_search(control, st, pct_base, pct_multiple);

	/* unmap buffer before closing and reallocating streams */
	if (unlikely(munmap(sb->buf_low, sb->size_low))) {
		close_stream_out(control, st->ss);
		failure("Failed to munmap in rzip_chunk\n");
	}
	if (!STDIN) {
		if (unlikely(munmap(sb->buf_high, sb->size_high))) {
			close_stream_out(control, st->ss);
			failure("Failed to munmap in rzip_chunk\n");
		}
	}

	if (unlikely(close_stream_out(control, st->ss)))
		failure("Failed to flush/close streams in rzip_chunk\n");

	/* Save the sinfo data to a list to be safely released after all
	 * threads have been shut down. */
	add_to_sslist(control, st);
}

static void clear_sslist(struct rzip_state *st)
{
	while (st->head) {
		struct node *node = st->head;
		struct stream_info *sinfo = node->data;

		dealloc(sinfo->s);
		dealloc(sinfo);
		st->head = node->prev;
		dealloc(node);
	}
}

/* compress a whole file chunks at a time */
void rzip_fd(rzip_control *control, int fd_in, int fd_out)
{
	struct sliding_buffer *sb = &control->sb;

	/* add timers for ETA estimates
	 * Base it off the file size and number of iterations required
	 * depending on compression window size
	 * Track elapsed time and estimated time to go
	 * If file size < compression window, can't do
	 */
	struct timeval current, start, last;
	i64 len = 0, last_chunk = 0;
	int pass = 0, passes, j;
	double chunkmbs, tdiff;
	struct rzip_state *st;
	struct stat s, s2;

	init_mutex(control, &control->control_lock);
	if (!NO_MD5)
		md5_init_ctx(&control->ctx);
	cksem_init(control, &control->cksumsem);
	cksem_post(control, &control->cksumsem);

	st = calloc(sizeof(*st), 1);
	if (unlikely(!st))
		failure("Failed to allocate control state in rzip_fd\n");

	if (LZO_COMPRESS) {
		if (unlikely(lzo_init() != LZO_E_OK)) {
			dealloc(st);
			failure("lzo_init() failed\n");
		}
	}

	if (unlikely(fstat(fd_in, &s))) {
		dealloc(st);
		failure("Failed to stat fd_in in rzip_fd\n");
	}

	if (!STDIN) {
		len = control->st_size = s.st_size;
		print_verbose("File size: %lld\n", len);
	} else
		control->st_size = 0;

	if (!STDOUT) {
		/* Check if there's enough free space on the device chosen to fit the
		* compressed file, based on the compressed file being as large as the
		* uncompressed file. */
		// todo: native methods to check
		print_err("Skipped space checking under native Windows.\n");

	}

	/* Optimal use of ram involves using no more than 2/3 of it, so we
	 * allocate 1/3 of it to the main buffer and use a sliding mmap
	 * buffer to work on 2/3 ram size, leaving enough ram for the
	 * compression backends */
	control->max_mmap = control->maxram;
	round_to_page(&control->max_mmap);

	/* Set maximum chunk size to 2/3 of ram if not unlimited or specified
	 * by a control window. When it's smaller than the file size, round it
	 * to page size for efficiency. */
	if (UNLIMITED)
		control->max_chunk = control->st_size;
	else if (control->window)
		control->max_chunk = control->window * CHUNK_MULTIPLE;
	else
		control->max_chunk = control->ramsize / 3 * 2;
	control->max_mmap = MIN(control->max_mmap, control->max_chunk);
	if (control->max_chunk < control->st_size)
		round_to_page(&control->max_chunk);

	if (!STDIN)
		st->chunk_size = MIN(control->max_chunk, len);
	else
		st->chunk_size = control->max_mmap;
	if (st->chunk_size < len)
		round_to_page(&st->chunk_size);

	st->level = &levels[control->compression_level];
	st->fd_in = fd_in;
	st->fd_out = fd_out;
	st->stdin_eof = 0;

	init_hash_indexes(st);

	passes = 0;

	/* set timers and chunk counter */
	last.tv_sec = last.tv_usec = 0;
	gettimeofday(&start, NULL);

	prepare_streamout_threads(control);
	control->do_mcpy = single_mcpy;
	control->next_tag = &single_next_tag;
	control->full_tag = &single_full_tag;
	control->match_len = &single_match_len;

	while (!pass || len > 0 || (STDIN && !st->stdin_eof)) {
		double pct_base, pct_multiple;
		i64 offset = s.st_size - len;
		int bits = 8;

		st->chunk_size = control->max_chunk;
		st->mmap_size = control->max_mmap;
		if (!STDIN) {
			st->chunk_size = MIN(st->chunk_size, len);
			if (likely(st->chunk_size))
				st->mmap_size = MIN(st->mmap_size, len);
			else
				st->mmap_size = control->page_size;
		}

retry:
		if (STDIN) {
			/* NOTE the buf is saved here for STDIN mode */
			sb->buf_low = mmap(NULL, st->mmap_size, PROT_READ | PROT_WRITE, MAP_ANONYMOUS | MAP_PRIVATE, -1, 0);
			/* Better to shrink the window to the largest size that works than fail */
			if (sb->buf_low == MAP_FAILED) {
				if (unlikely(errno != ENOMEM)) {
					close_streamout_threads(control);
					dealloc(st->hash_table);
					dealloc(st);
					failure("Failed to mmap %s\n", control->infile);
				}
				st->mmap_size = st->mmap_size / 10 * 9;
				round_to_page(&st->mmap_size);
				if (unlikely(!st->mmap_size)) {
					close_streamout_threads(control);
					dealloc(st->hash_table);
					dealloc(st);
					failure("Unable to mmap any ram\n");
				}
				goto retry;
			}
			st->chunk_size = st->mmap_size;
			mmap_stdin(control, sb->buf_low, st);
		} else {
			/* NOTE The buf is saved here for !STDIN mode */
			sb->buf_low = (uchar *)mmap(sb->buf_low, st->mmap_size, PROT_READ, MAP_SHARED, fd_in, offset);
			if (sb->buf_low == MAP_FAILED) {
				if (unlikely(errno != ENOMEM)) {
					close_streamout_threads(control);
					dealloc(st->hash_table);
					dealloc(st);
					failure("Failed to mmap %s\n", control->infile);
				}
				st->mmap_size = st->mmap_size / 10 * 9;
				round_to_page(&st->mmap_size);
				if (unlikely(!st->mmap_size)) {
					close_streamout_threads(control);
					dealloc(st->hash_table);
					dealloc(st);
					failure("Unable to mmap any ram\n");
				}
				goto retry;
			}
			if (st->mmap_size < st->chunk_size) {
				print_maxverbose("Enabling sliding mmap mode and using mmap of %lld bytes with window of %lld bytes\n", st->mmap_size, st->chunk_size);
				control->do_mcpy = &sliding_mcpy;
				control->next_tag = &sliding_next_tag;
				control->full_tag = &sliding_full_tag;
				control->match_len = &sliding_match_len;
			}
		}
		print_maxverbose("Succeeded in testing %lld sized mmap for rzip pre-processing\n", st->mmap_size);

		if (st->chunk_size > control->ramsize)
			print_verbose("Compression window is larger than ram, will proceed with unlimited mode possibly much slower\n");

		if (!passes && !STDIN && st->chunk_size) {
			passes = s.st_size / st->chunk_size + !!(s.st_size % st->chunk_size);
			if (passes == 1)
				print_verbose("Will take 1 pass\n");
			else
				print_verbose("Will take %d passes\n", passes);
		}

		sb->orig_offset = offset;
		print_maxverbose("Chunk size: %lld\n", st->chunk_size);

		/* Determine the chunk byte width to write to the file
		 * This allows archives of different chunk sizes to have
		 * optimal byte width entries. When working with stdin we
		 * won't know in advance how big it is so it will always be
		 * rounded up to the window size. */
		while (st->chunk_size >> bits > 0)
			bits++;
		st->chunk_bytes = bits / 8;
		if (bits % 8)
			st->chunk_bytes++;
		print_maxverbose("Byte width: %d\n", st->chunk_bytes);

		if (STDIN)
			pct_base = (100.0 * -len) / control->st_size;
		else
			pct_base = (100.0 * (control->st_size - len)) / control->st_size;
		pct_multiple = ((double)st->chunk_size) / control->st_size;
		pass++;
		if (st->stdin_eof)
			passes = pass;

		gettimeofday(&current, NULL);
		/* this will count only when size > window */
		if (last.tv_sec > 0 && pct_base > 100) {
			unsigned int eta_hours, eta_minutes, eta_seconds, elapsed_time, finish_time,
				elapsed_hours, elapsed_minutes, elapsed_seconds, diff_seconds;

			elapsed_time = current.tv_sec - start.tv_sec;
			finish_time = elapsed_time / (pct_base / 100.0);
			elapsed_hours = elapsed_time / 3600;
			elapsed_minutes = (elapsed_time / 60) % 60;
			elapsed_seconds = elapsed_time % 60;
			diff_seconds = finish_time - elapsed_time;
			eta_hours = diff_seconds / 3600;
			eta_minutes = (diff_seconds / 60) % 60;
			eta_seconds = diff_seconds % 60;

			chunkmbs = (last_chunk / 1024 / 1024) / (double)(current.tv_sec-last.tv_sec);
			if (!STDIN || st->stdin_eof)
				print_verbose("\nPass %d / %d -- Elapsed Time: %02d:%02d:%02d. ETA: %02d:%02d:%02d. Compress Speed: %3.3fMB/s.\n",
					pass, passes, elapsed_hours, elapsed_minutes, elapsed_seconds,
					eta_hours, eta_minutes, eta_seconds, chunkmbs);
			else
				print_verbose("\nPass %d -- Elapsed Time: %02d:%02d:%02d. Compress Speed: %3.3fMB/s.\n",
					pass, elapsed_hours, elapsed_minutes, elapsed_seconds, chunkmbs);
		}
		last.tv_sec = current.tv_sec;
		last.tv_usec = current.tv_usec;

		if (st->chunk_size == len)
			control->eof = 1;
		rzip_chunk(control, st, fd_in, fd_out, offset, pct_base, pct_multiple);

		/* st->chunk_size may be shrunk in rzip_chunk */
		last_chunk = st->chunk_size;
		len -= st->chunk_size;
		if (unlikely(len > 0 && control->eof)) {
			close_streamout_threads(control);
			dealloc(st->hash_table);
			dealloc(st);
			failure("Wrote EOF to file yet chunk_size was shrunk, corrupting archive.\n");
		}
	}

	if (likely(st->hash_table))
		dealloc(st->hash_table);
	if (unlikely(!close_streamout_threads(control))) {
		dealloc(st);
		failure("Failed to close_streamout_threads in rzip_fd\n");
	}

	if (!NO_MD5) {
		/* Temporary workaround till someone fixes apple md5 */
		md5_finish_ctx(&control->ctx, control->md5_resblock);
		if (HASH_CHECK || MAX_VERBOSE) {
			print_output("MD5: ");
			for (j = 0; j < MD5_DIGEST_SIZE; j++)
				print_output("%02x", control->md5_resblock[j] & 0xFF);
			print_output("\n");
		}
		/* When encrypting data, we encrypt the MD5 value as well */
		if (ENCRYPT)
			if (unlikely(!lrz_encrypt(control, control->md5_resblock, MD5_DIGEST_SIZE, control->salt_pass))) {
				dealloc(st);
				failure("Failed to lrz_encrypt in rzip_fd\n");
			}
		if (unlikely(write_1g(control, control->md5_resblock, MD5_DIGEST_SIZE) != MD5_DIGEST_SIZE)) {
			dealloc(st);
			failure("Failed to write md5 in rzip_fd\n");
		}
	}

	if (unlikely(!flush_tmpout(control))) {
			dealloc(st);
			failure("Failed to flush_tmpout in rzip_fd\n");
	}

	gettimeofday(&current, NULL);
	if (STDIN)
		s.st_size = control->st_size;
	tdiff = current.tv_sec - start.tv_sec;
	if (!tdiff)
		tdiff = 1;
	chunkmbs = (s.st_size / 1024 / 1024) / tdiff;

	fstat(fd_out, &s2);

	print_maxverbose("matches=%u match_bytes=%u\n",
	       (unsigned int)st->stats.matches, (unsigned int)st->stats.match_bytes);
	print_maxverbose("literals=%u literal_bytes=%u\n",
	       (unsigned int)st->stats.literals, (unsigned int)st->stats.literal_bytes);
	print_maxverbose("true_tag_positives=%u false_tag_positives=%u\n",
	       (unsigned int)st->stats.tag_hits, (unsigned int)st->stats.tag_misses);
	print_maxverbose("inserts=%u match %.3f\n",
	       (unsigned int)st->stats.inserts,
	       (1.0 + st->stats.match_bytes) / st->stats.literal_bytes);

	if (!STDIN)
		print_output("%s - ", control->infile);
	print_output("Compression Ratio: %.3f. Average Compression Speed: %6.3fMB/s.\n",
		       1.0 * s.st_size / s2.st_size, chunkmbs);

	clear_sslist(st);
	dealloc(st);
}
