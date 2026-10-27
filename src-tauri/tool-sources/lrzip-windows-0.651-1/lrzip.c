/*
   Copyright (C) 2006-2016,2018,2021-2022 Con Kolivas
   Copyright (C) 2011 Peter Hyman
   Copyright (C) 1998-2003 Andrew Tridgell

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

#ifdef HAVE_CONFIG_H
# include "config.h"
#endif

#include <sys/types.h>
#ifdef HAVE_SYS_STAT_H
# include <sys/stat.h>
#endif
#include <fcntl.h>
#ifdef HAVE_UNISTD_H
# include <unistd.h>
#endif
#ifdef HAVE_ERRNO_H
#include <errno.h>
#endif
#include <sys/time.h>
#ifdef HAVE_ENDIAN_H
# include <endian.h>
#elif HAVE_SYS_ENDIAN_H
# include <sys/endian.h>
#endif
#ifdef HAVE_ARPA_INET_H
# include <arpa/inet.h>
#endif
#include <math.h>
#include <utime.h>
#include <inttypes.h>

#include "md5.h"
#include "rzip.h"
#include "runzip.h"
#include "util.h"
#include "stream.h"

#if defined(_WIN32) || defined(_WIN64)
#include <Windows.h>
#include "mman.h"
#endif
#include "misc.h"

#define MAGIC_LEN (24)
#define STDIO_TMPFILE_BUFFER_SIZE (65536) // used in read_tmpinfile and dump_tmpoutfile

static void release_hashes(rzip_control *control);

static i64 fdout_seekto(rzip_control *control, i64 pos)
{
	if (TMP_OUTBUF) {
		pos -= control->out_relofs;
		control->out_ofs = pos;
		if (unlikely(pos > control->out_len || pos < 0)) {
			print_err("Trying to seek to %lld outside tmp outbuf in fdout_seekto\n", pos);
			return -1;
		}
		return 0;
	}
	return lseek(control->fd_out, pos, SEEK_SET);
}

#if defined(_WIN32) || defined(_WIN64)
#include <stdint.h>
i64 get_ram(rzip_control* ignored) {
	uint64_t ret;
	GetPhysicallyInstalledSystemMemory(&ret);
	return ret << 10;
}
#elif defined(__APPLE__)
# include <sys/sysctl.h>
i64 get_ram(rzip_control *control)
{
	int mib[2];
	size_t len;
	i64 *p, ramsize;

	mib[0] = CTL_HW;
	mib[1] = HW_MEMSIZE;
	sysctl(mib, 2, NULL, &len, NULL, 0);
	p = malloc(len);
	sysctl(mib, 2, p, &len, NULL, 0);
	ramsize = *p;

	return ramsize;
}
#elif defined(__OpenBSD__)
# include <sys/resource.h>
i64 get_ram(rzip_control *control)
{
	struct rlimit rl;
	i64 ramsize = (i64)sysconf(_SC_PHYS_PAGES) * PAGE_SIZE;

	/* Raise limits all the way to the max */

	if (getrlimit(RLIMIT_DATA, &rl) == -1)
		fatal_return(("Failed to get limits in get_ram\n"), -1);

	rl.rlim_cur = rl.rlim_max;
	if (setrlimit(RLIMIT_DATA, &rl) == -1)
		fatal_return(("Failed to set limits in get_ram\n"), -1);

	/* Declare detected RAM to be either the max RAM available from
	physical memory or the max RAM allowed by RLIMIT_DATA, whatever
	is smaller, to prevent the heuristics from selecting
	compression windows which cause lrzip to go into deep swap */

	if (rl.rlim_max < ramsize)
		return rl.rlim_max;

	return ramsize;
}
#else /* __APPLE__ */
i64 get_ram(rzip_control *control)
{
	i64 ramsize;
	FILE *meminfo;
	char aux[256];

	ramsize = (i64)sysconf(_SC_PHYS_PAGES) * PAGE_SIZE;
	if (ramsize > 0)
		return ramsize;

	/* Workaround for uclibc which doesn't properly support sysconf */
	if(!(meminfo = fopen("/proc/meminfo", "r")))
		fatal_return(("fopen\n"), -1);

	while(!feof(meminfo) && !fscanf(meminfo, "MemTotal: %"PRId64" kB", &ramsize)) {
		if (unlikely(fgets(aux, sizeof(aux), meminfo) == NULL)) {
			fclose(meminfo);
			fatal_return(("Failed to fgets in get_ram\n"), -1);
		}
	}
	if (fclose(meminfo) == -1)
		fatal_return(("fclose"), -1);
	ramsize *= 1000;

	return ramsize;
}
#endif

i64 nloops(i64 seconds, uchar *b1, uchar *b2)
{
	i64 nloops;
	int nbits;

	nloops = ARBITRARY_AT_EPOCH * pow(MOORE_TIMES_PER_SECOND, seconds);
	if (nloops < ARBITRARY)
		nloops = ARBITRARY;
	for (nbits = 0; nloops > 255; nbits ++)
		nloops = nloops >> 1;
	*b1 = nbits;
	*b2 = nloops;
	return nloops << nbits;
}


bool write_magic(rzip_control *control)
{
	char magic[MAGIC_LEN] = { 
		'L', 'R', 'Z', 'I', LRZIP_MAJOR_VERSION, LRZIP_MINOR_VERSION 
	};

	/* File size is stored as zero for streaming STDOUT blocks when the
	 * file size is unknown. In encrypted files, the size is left unknown
	 * and instead the salt is stored here to preserve space. */
	if (ENCRYPT)
		memcpy(&magic[6], &control->salt, 8);
	else if (!STDIN || !STDOUT || control->eof) {
		i64 esize = htole64(control->st_size);

		memcpy(&magic[6], &esize, 8);
	}

	/* save LZMA compression flags */
	if (LZMA_COMPRESS) {
		int i;

		for (i = 0; i < 5; i++)
			magic[i + 16] = (char)control->lzma_properties[i];
	}

	/* This is a flag that the archive contains an md5 sum at the end
	 * which can be used as an integrity check instead of crc check.
	 * crc is still stored for compatibility with 0.5 versions.
	 */
	if (!NO_MD5)
		magic[21] = 1;
	if (ENCRYPT)
		magic[22] = 1;

	if (unlikely(fdout_seekto(control, 0)))
		fatal_return(("Failed to seek to BOF to write Magic Header\n"), false);

	if (unlikely(put_fdout(control, magic, MAGIC_LEN) != MAGIC_LEN))
		fatal_return(("Failed to write magic header\n"), false);
	control->magic_written = 1;
	return true;
}

static inline i64 enc_loops(uchar b1, uchar b2)
{
	return (i64)b2 << (i64)b1;
}

static bool get_magic(rzip_control *control, char *magic)
{
	int encrypted, md5, i;
	i64 expected_size;
	uint32_t v;

	if (unlikely(strncmp(magic, "LRZI", 4)))
		failure_return(("Not an lrzip file\n"), false);

	memcpy(&control->major_version, &magic[4], 1);
	memcpy(&control->minor_version, &magic[5], 1);

	print_verbose("Detected lrzip version %d.%d file.\n", control->major_version, control->minor_version);
	if (control->major_version > LRZIP_MAJOR_VERSION ||
	    (control->major_version == LRZIP_MAJOR_VERSION && control->minor_version > LRZIP_MINOR_VERSION))
		print_output("Attempting to work with file produced by newer lrzip version %d.%d file.\n", control->major_version, control->minor_version);

	/* Support the convoluted way we described size in versions < 0.40 */
	if (control->major_version == 0 && control->minor_version < 4) {
		memcpy(&v, &magic[6], 4);
		expected_size = ntohl(v);
		memcpy(&v, &magic[10], 4);
		expected_size |= ((i64)ntohl(v)) << 32;
	} else {
		memcpy(&expected_size, &magic[6], 8);
		expected_size = le64toh(expected_size);
	}
	control->st_size = expected_size;
	if (control->major_version == 0 && control->minor_version < 6)
		control->eof = 1;

	/* restore LZMA compression flags only if stored */
	if ((int) magic[16]) {
		for (i = 0; i < 5; i++)
			control->lzma_properties[i] = magic[i + 16];
		/* Cludge to allow us to read possibly corrupted archives */
		if (!control->lzma_properties[0])
			control->lzma_properties[0] = 93;
	}

	/* Whether this archive contains md5 data at the end or not */
	md5 = magic[21];
	if (md5) {
		if (md5 == 1)
			control->flags |= FLAG_MD5;
		else
			print_verbose("Unknown hash, falling back to CRC\n");
	}
	encrypted = magic[22];
	if (encrypted) {
		if (encrypted == 1)
			control->flags |= FLAG_ENCRYPT;
		else
			failure_return(("Unknown encryption\n"), false);
		/* In encrypted files, the size field is used to store the salt
		 * instead and the size is unknown, just like a STDOUT chunked
		 * file */
		memcpy(&control->salt, &magic[6], 8);
		control->st_size = expected_size = 0;
		control->encloops = enc_loops(control->salt[0], control->salt[1]);
		print_maxverbose("Encryption hash loops %lld\n", control->encloops);
	} else if (ENCRYPT) {
		print_output("Asked to decrypt a non-encrypted archive. Bypassing decryption.\n");
		control->flags &= ~FLAG_ENCRYPT;
	}
	return true;
}

bool read_magic(rzip_control *control, int fd_in, i64 *expected_size)
{
	char magic[MAGIC_LEN];

	memset(magic, 0, sizeof(magic));
	/* Initially read only <v0.6x header */
	if (unlikely(read(fd_in, magic, 24) != 24))
		fatal_return(("Failed to read magic header\n"), false);

	if (unlikely(!get_magic(control, magic)))
		return false;
	*expected_size = control->st_size;
	return true;
}

/* preserve ownership and permissions where possible */
static bool preserve_perms(rzip_control *control, int fd_in, int fd_out)
{
	struct stat st;

	if (unlikely(fstat(fd_in, &st)))
		fatal_return(("Failed to fstat input file\n"), false);
	return true;
}

static bool preserve_times(rzip_control *control, int fd_in)
{
	struct utimbuf times;
	struct stat st;

	if (unlikely(fstat(fd_in, &st)))
		fatal_return(("Failed to fstat input file\n"), false);
	times.actime = 0;
	times.modtime = st.st_mtime;
	if (unlikely(utime(control->outfile, &times)))
		print_verbose("Warning, unable to set time on %s\n", control->outfile);

	return true;
}

/* Open a temporary outputfile to emulate stdout */
int open_tmpoutfile(rzip_control *control)
{
	int fd_out;

	if (STDOUT && !TEST_ONLY)
		print_verbose("Outputting to stdout.\n");
	if (control->tmpdir) {
		control->outfile = realloc(NULL, strlen(control->tmpdir) + 16);
		if (unlikely(!control->outfile))
			fatal_return(("Failed to allocate outfile name\n"), -1);
		strcpy(control->outfile, control->tmpdir);
		strcat(control->outfile, "lrzipout.XXXXXX");
	}

	fd_out = mkstemp(control->outfile);
	if (fd_out == -1) {
		print_output("WARNING: Failed to create out tmpfile: %s, will fail if cannot perform %scompression entirely in ram\n",
			       control->outfile, DECOMPRESS ? "de" : "");
	} else
		register_outfile(control, control->outfile, TEST_ONLY || STDOUT || !KEEP_BROKEN);
	print_maxverbose("Created temporary outfile %s\n", control->outfile);
	return fd_out;
}

static bool fwrite_stdout(rzip_control *control, void *buf, i64 len)
{
	uchar *offset_buf = buf;
	ssize_t ret;
	i64 total;

	total = 0;
	while (len > 0) {
		ssize_t wrote;

		if (BITS32)
			ret = MIN(len, one_g);
		else
			ret = len;
		wrote = fwrite(offset_buf, 1, ret, control->outFILE);
		if (unlikely(wrote != ret))
			fatal_return(("Failed to fwrite in fwrite_stdout\n"), false);
		len -= ret;
		offset_buf += ret;
		total += ret;
	}
	fflush(control->outFILE);
	return true;
}

bool write_fdout(rzip_control *control, void *buf, i64 len)
{
	uchar *offset_buf = buf;
	ssize_t ret;

	while (len > 0) {
		if (BITS32)
			ret = MIN(len, one_g);
		else
			ret = len;
		ret = write(control->fd_out, offset_buf, (size_t)ret);
		if (unlikely(ret <= 0))
			fatal_return(("Failed to write to fd_out in write_fdout\n"), false);
		len -= ret;
		offset_buf += ret;
	}
	return true;
}

static bool flush_tmpoutbuf(rzip_control *control)
{
	if (!TEST_ONLY) {
		print_maxverbose("Dumping buffer to physical file.\n");
		if (STDOUT) {
			if (unlikely(!fwrite_stdout(control, control->tmp_outbuf, control->out_len)))
				return false;
		} else {
			if (unlikely(!write_fdout(control, control->tmp_outbuf, control->out_len)))
				return false;
		}
	}
	control->out_relofs += control->out_len;
	control->out_ofs = control->out_len = 0;
	return true;
}

/* Dump temporary outputfile to perform stdout */
static bool dump_tmpoutfile(rzip_control *control)
{
	int fd_out = control->fd_out;
	FILE *tmpoutfp;

	if (unlikely(fd_out == -1))
		fatal_return(("Failed: No temporary outfile created, unable to do in ram\n"), false);
	/* flush anything not yet in the temporary file */
	tmpoutfp = fdopen(fd_out, "rb");
	if (unlikely(tmpoutfp == NULL))
		fatal_return(("Failed to fdopen out tmpfile\n"), false);
	rewind(tmpoutfp);

	if (!TEST_ONLY) {
		char* buf;

		print_verbose("Dumping temporary file to control->outFILE.\n");
		fflush(control->outFILE);

		buf = malloc(STDIO_TMPFILE_BUFFER_SIZE);
		if (unlikely(!buf))
			fatal_return(("Failed to allocate buffer in dump_tmpoutfile\n"), false);

		while (1) {
			ssize_t num_read, num_written;
			num_read = fread(buf, 1, STDIO_TMPFILE_BUFFER_SIZE, tmpoutfp);
			if (unlikely(num_read == 0)) {
				if (ferror(tmpoutfp)) {
					dealloc(buf);
					fatal_return(("Failed read in dump_tmpoutfile\n"), false);
				} else {
					break; // must be at EOF
				}
			}

			num_written = fwrite(buf, 1, num_read, control->outFILE);
			if (unlikely(num_written != num_read)) {
				dealloc(buf);
				fatal_return(("Failed write in dump_tmpoutfile\n"), false);
			}
		}

		dealloc(buf);
		fflush(control->outFILE);
		rewind(tmpoutfp);
	}

	if (unlikely(ftruncate(fd_out, 0)))
		fatal_return(("Failed to ftruncate fd_out in dump_tmpoutfile\n"), false);
	return true;
}

bool flush_tmpout(rzip_control *control)
{
	if (!STDOUT)
		return true;
	if (TMP_OUTBUF)
		return flush_tmpoutbuf(control);
	return dump_tmpoutfile(control);
}

/* Used if we're unable to read STDIN into the temporary buffer, shunts data
 * to temporary file */
bool write_fdin(rzip_control *control)
{
	uchar *offset_buf = control->tmp_inbuf;
	i64 len = control->in_len;
	ssize_t ret;

	while (len > 0) {
		if (BITS32)
			ret = MIN(len, one_g);
		else
			ret = len;
		ret = write(control->fd_in, offset_buf, (size_t)ret);
		if (unlikely(ret <= 0))
			fatal_return(("Failed to write to fd_in in write_fdin\n"), false);
		len -= ret;
		offset_buf += ret;
	}
	return true;
}

/* Open a temporary inputfile to perform stdin decompression */
int open_tmpinfile(rzip_control *control)
{
	int fd_in = -1;

	/* Use temporary directory if there is one */
	if (control->tmpdir) {
		control->infile = malloc(strlen(control->tmpdir) + 15);
		if (unlikely(!control->infile))
			fatal_return(("Failed to allocate infile name\n"), -1);
		strcpy(control->infile, control->tmpdir);
		strcat(control->infile, "lrzipin.XXXXXX");
		fd_in = mkstemp(control->infile);
	}

	/* Try the current directory */
	if (fd_in == -1) {
		dealloc(control->infile);
		control->infile = malloc(16);
		if (unlikely(!control->infile))
			fatal_return(("Failed to allocate infile name\n"), -1);
		strcpy(control->infile, "lrzipin.XXXXXX");
		fd_in = mkstemp(control->infile);
	}

	/* Use /tmp if nothing is writeable so far */
	if (fd_in == -1) {
		dealloc(control->infile);
		control->infile = malloc(20);
		if (unlikely(!control->infile))
			fatal_return(("Failed to allocate infile name\n"), -1);
		strcpy(control->infile, "/tmp/lrzipin.XXXXXX");
		fd_in = mkstemp(control->infile);
	}

	if (fd_in == -1) {
		print_output("WARNING: Failed to create in tmpfile: %s, will fail if cannot perform %scompression entirely in ram\n",
			       control->infile, DECOMPRESS ? "de" : "");
	} else {
		register_infile(control, control->infile, (DECOMPRESS || TEST_ONLY) && STDIN);
		/* Unlink temporary file immediately to minimise chance of files left
		* lying around in cases of failure_return((. */
		if (unlikely(unlink(control->infile))) {
			fatal("Failed to unlink tmpfile: %s\n", control->infile);
			close(fd_in);
			return -1;
		}
	}
	return fd_in;
}

static bool read_tmpinmagic(rzip_control *control)
{
	char magic[MAGIC_LEN];
	int i, tmpchar;

	memset(magic, 0, sizeof(magic));
	for (i = 0; i < 24; i++) {
		tmpchar = getchar();
		if (unlikely(tmpchar == EOF))
			failure_return(("Reached end of file on STDIN prematurely on v05 magic read\n"), false);
		magic[i] = (char)tmpchar;
	}
	return get_magic(control, magic);
}

/* Read data from stdin into temporary inputfile */
bool read_tmpinfile(rzip_control *control, int fd_in)
{
	FILE *tmpinfp;
	char* buf;

	if (fd_in == -1)
		return false;
	if (control->flags & FLAG_SHOW_PROGRESS)
		fprintf(control->msgout, "Copying from stdin.\n");
	tmpinfp = fdopen(fd_in, "w+b");
	if (unlikely(tmpinfp == NULL))
		fatal_return(("Failed to fdopen in tmpfile\n"), false);

	buf = malloc(STDIO_TMPFILE_BUFFER_SIZE);
	if (unlikely(!buf))
		fatal_return(("Failed to allocate buffer in read_tmpinfile\n"), false);

	while (1) {
		ssize_t num_read, num_written;
		num_read = fread(buf, 1, STDIO_TMPFILE_BUFFER_SIZE, stdin);
		if (unlikely(num_read == 0)) {
			if (ferror(stdin)) {
				dealloc(buf);
				fatal_return(("Failed read in read_tmpinfile\n"), false);
			} else {
				break; // must be at EOF
			}
		}

		num_written = fwrite(buf, 1, num_read, tmpinfp);
		if (unlikely(num_written != num_read)) {
			dealloc(buf);
			fatal_return(("Failed write in read_tmpinfile\n"), false);
		}
	}

	dealloc(buf);
	fflush(tmpinfp);
	rewind(tmpinfp);
	return true;
}

/* To perform STDOUT, we allocate a proportion of ram that is then used as
 * a pseudo-temporary file */
static bool open_tmpoutbuf(rzip_control *control)
{
	i64 maxlen = control->maxram;
	void *buf;

	while (42) {
		round_to_page(&maxlen);
		buf = malloc(maxlen);
		if (buf) {
			print_maxverbose("Malloced %"PRId64" for tmp_outbuf\n", maxlen);
			break;
		}
		maxlen = maxlen / 3 * 2;
		if (maxlen < 100000000)
			fatal_return(("Unable to even malloc 100MB for tmp_outbuf\n"), false);
	}
	control->flags |= FLAG_TMP_OUTBUF;
	/* Allocate slightly more so we can cope when the buffer overflows and
	 * fall back to a real temporary file */
	control->out_maxlen = maxlen - control->page_size;
	control->tmp_outbuf = buf;
	if (!DECOMPRESS && !TEST_ONLY)
		control->out_ofs = control->out_len = MAGIC_LEN;\
	return true;
}

/* We've decided to use a temporary output file instead of trying to store
 * all the output buffer in ram so we can free up the ram and increase the
 * maximum sizes of ram we can allocate */
void close_tmpoutbuf(rzip_control *control)
{
	control->flags &= ~FLAG_TMP_OUTBUF;
	dealloc(control->tmp_outbuf);
	if (!BITS32)
		control->usable_ram = control->maxram += control->ramsize / 18;
}

static bool open_tmpinbuf(rzip_control *control)
{
	control->flags |= FLAG_TMP_INBUF;
	control->in_maxlen = control->maxram;
	control->tmp_inbuf = malloc(control->maxram + control->page_size);
	if (unlikely(!control->tmp_inbuf))
		fatal_return(("Failed to malloc tmp_inbuf in open_tmpinbuf\n"), false);
	return true;
}

void clear_tmpinbuf(rzip_control *control)
{
	control->in_len = control->in_ofs = 0;
}

bool clear_tmpinfile(rzip_control *control)
{
	if (unlikely(lseek(control->fd_in, 0, SEEK_SET)))
		fatal_return(("Failed to lseek on fd_in in clear_tmpinfile\n"), false);
	if (unlikely(ftruncate(control->fd_in, 0)))
		fatal_return(("Failed to truncate fd_in in clear_tmpinfile\n"), false);
	return true;
}

/* As per temporary output file but for input file */
void close_tmpinbuf(rzip_control *control)
{
	control->flags &= ~FLAG_TMP_INBUF;
	dealloc(control->tmp_inbuf);
	if (!BITS32)
		control->usable_ram = control->maxram += control->ramsize / 18;
}

static int get_pass(rzip_control *control, char *s)
{
	int len;

	memset(s, 0, PASS_LEN - SALT_LEN);
	if (control->passphrase)
		strncpy(s, control->passphrase, PASS_LEN - SALT_LEN - 1);
	else if (unlikely(fgets(s, PASS_LEN - SALT_LEN, stdin) == NULL))
		failure_return(("Failed to retrieve passphrase\n"), -1);
	len = strlen(s);
	if (len > 0 && ('\r' ==  s[len - 1] || '\n' == s[len - 1]))
		s[len - 1] = '\0';
	if (len > 1 && ('\r' ==  s[len - 2] || '\n' == s[len - 2]))
		s[len - 2] = '\0';
	len = strlen(s);
	if (unlikely(0 == len))
		failure_return(("Empty passphrase\n"), -1);
	return len;
}

static bool get_hash(rzip_control *control, int make_hash)
{
	char *passphrase, *testphrase;
	int prompt = control->passphrase == NULL;

	passphrase = calloc(PASS_LEN, 1);
	testphrase = calloc(PASS_LEN, 1);
	control->salt_pass = calloc(PASS_LEN, 1);
	control->hash = calloc(HASH_LEN, 1);
	if (unlikely(!passphrase || !testphrase || !control->salt_pass || !control->hash)) {
		fatal("Failed to calloc encrypt buffers in compress_file\n");
		dealloc(testphrase);
		dealloc(passphrase);
		return false;
	}
	mlock(passphrase, PASS_LEN);
	mlock(testphrase, PASS_LEN);
	mlock(control->salt_pass, PASS_LEN);
	mlock(control->hash, HASH_LEN);

	if (control->pass_cb) {
		control->pass_cb(control->pass_data, passphrase, PASS_LEN - SALT_LEN);
		if (!passphrase[0]) {
			fatal("Supplied password was null!");
			munlock(passphrase, PASS_LEN);
			munlock(testphrase, PASS_LEN);
			dealloc(testphrase);
			dealloc(passphrase);
			release_hashes(control);
			return false;
		}
		control->salt_pass_len = strlen(passphrase) + SALT_LEN;
	} else {
		/* Disable stdin echo to screen */
		// Skipping disable as termios unavailable.
retry_pass:
		if (prompt)
			print_output("Enter passphrase: ");
		control->salt_pass_len = get_pass(control, passphrase) + SALT_LEN;
		if (prompt)
			print_output("\n");
		if (make_hash) {
			if (prompt)
				print_output("Re-enter passphrase: ");
			get_pass(control, testphrase);
			if (prompt)
				print_output("\n");
			if (strcmp(passphrase, testphrase)) {
				print_output("Passwords do not match. Try again.\n");
				goto retry_pass;
			}
		}
		memset(testphrase, 0, PASS_LEN);
	}
	memcpy(control->salt_pass, control->salt, SALT_LEN);
	memcpy(control->salt_pass + SALT_LEN, passphrase, PASS_LEN - SALT_LEN);
	lrz_stretch(control);
	memset(passphrase, 0, PASS_LEN);
	munlock(passphrase, PASS_LEN);
	munlock(testphrase, PASS_LEN);
	dealloc(testphrase);
	dealloc(passphrase);
	return true;
}

static void release_hashes(rzip_control *control)
{
	memset(control->salt_pass, 0, PASS_LEN);
	memset(control->hash, 0, SALT_LEN);
	munlock(control->salt_pass, PASS_LEN);
	munlock(control->hash, HASH_LEN);
	dealloc(control->salt_pass);
	dealloc(control->hash);
}

static void clear_rulist(rzip_control *control)
{
	while (control->ruhead) {
		struct runzip_node *node = control->ruhead;
		struct stream_info *sinfo = node->sinfo;

		dealloc(sinfo->ucthreads);
		dealloc(node->pthreads);
		dealloc(sinfo->s);
		dealloc(sinfo);
		control->ruhead = node->prev;
		dealloc(node);
	}
}

/*
  decompress one file from the command line
*/
bool decompress_file(rzip_control *control)
{
	char *tmp, *tmpoutfile, *infilecopy = NULL;
	int fd_in, fd_out = -1, fd_hist = -1;
	i64 expected_size = 0;

	if (!STDIN && !IS_FROM_FILE) {
		struct stat fdin_stat;

		stat(control->infile, &fdin_stat);
		if (!S_ISREG(fdin_stat.st_mode) && (tmp = strrchr(control->infile, '.')) &&
		    strcmp(tmp,control->suffix)) {
			/* make sure infile has an extension. If not, add it
			  * because manipulations may be made to input filename, set local ptr
			*/
			infilecopy = alloca(strlen(control->infile) + strlen(control->suffix) + 1);
			strcpy(infilecopy, control->infile);
			strcat(infilecopy, control->suffix);
		} else
			infilecopy = strdupa(control->infile);
		/* regardless, infilecopy has the input filename */
	}

	if (!STDOUT && !TEST_ONLY) {
		/* if output name already set, use it */
		if (control->outname) {
			control->outfile = strdup(control->outname);
		} else {
			/* default output name from infilecopy
			 * test if outdir specified. If so, strip path from filename of
			 * infilecopy, then remove suffix.
			*/
			if (control->outdir && (tmp = strrchr(infilecopy, '/')))
				tmpoutfile = strdupa(tmp + 1);
			else
				tmpoutfile = strdupa(infilecopy);

			/* remove suffix to make outfile name */
			if ((tmp = strrchr(tmpoutfile, '.')) && !strcmp(tmp, control->suffix))
				*tmp='\0';

			control->outfile = malloc((control->outdir == NULL? 0: strlen(control->outdir)) + strlen(tmpoutfile) + 1);
			if (unlikely(!control->outfile))
				fatal_return(("Failed to allocate outfile name\n"), false);

			if (control->outdir) {	/* prepend control->outdir */
				strcpy(control->outfile, control->outdir);
				strcat(control->outfile, tmpoutfile);
			} else
				strcpy(control->outfile, tmpoutfile);
		}

		if (!STDOUT)
			print_output("Output filename is: %s\n", control->outfile);
	}

	if ( IS_FROM_FILE ) {
		fd_in = fileno(control->inFILE);
	}
	else if (STDIN) {
		fd_in = open_tmpinfile(control);
		read_tmpinmagic(control);
		if (ENCRYPT)
			failure_return(("Cannot decompress encrypted file from STDIN\n"), false);
		expected_size = control->st_size;
		if (unlikely(!open_tmpinbuf(control)))
			return false;
	} else {
		fd_in = open(infilecopy, O_BINARY | O_RDONLY);
		if (unlikely(fd_in == -1)) {
			fatal_return(("Failed to open %s\n", infilecopy), false);
		}
	}
	control->fd_in = fd_in;

	if (!(TEST_ONLY | STDOUT)) {
		fd_out = open(control->outfile, O_BINARY | O_WRONLY | O_CREAT | O_EXCL, 0666);
		if (FORCE_REPLACE && (-1 == fd_out) && (EEXIST == errno)) {
			if (unlikely(unlink(control->outfile)))
				fatal_return(("Failed to unlink an existing file: %s\n", control->outfile), false);
			fd_out = open(control->outfile, O_BINARY | O_WRONLY | O_CREAT | O_EXCL, 0666);
		}
		if (unlikely(fd_out == -1)) {
			/* We must ensure we don't delete a file that already
			 * exists just because we tried to create a new one */
			control->flags |= FLAG_KEEP_BROKEN;
			fatal_return(("Failed to create %s\n", control->outfile), false);
		}
		fd_hist = open(control->outfile, O_BINARY | O_RDONLY);
		if (unlikely(fd_hist == -1))
			fatal_return(("Failed to open history file %s\n", control->outfile), false);

		/* Can't copy permissions from STDIN */
		if (!STDIN)
			if (unlikely(!preserve_perms(control, fd_in, fd_out)))
				return false;
	} else {
		fd_out = open_tmpoutfile(control);
		if (fd_out == -1) {
			fd_hist = -1;
		} else {
			fd_hist = open(control->outfile, O_BINARY | O_RDONLY);
			if (unlikely(fd_hist == -1))
				fatal_return(("Failed to open history file %s\n", control->outfile), false);
			/* Unlink temporary file as soon as possible */
			if (unlikely(unlink(control->outfile)))
				fatal_return(("Failed to unlink tmpfile: %s\n", control->outfile), false);
		}
	}

	if (STDOUT) {
		if (unlikely(!open_tmpoutbuf(control)))
			return false;
	}

	if (!STDIN) {
		if (unlikely(!read_magic(control, fd_in, &expected_size)))
			return false;
		if (unlikely(expected_size < 0))
			fatal_return(("Invalid expected size %lld\n", expected_size), false);
	}

	if (!STDOUT && !TEST_ONLY) {
		/* Check if there's enough free space on the device chosen to fit the
		* decompressed file. */

		// todo: native methods to check
		print_err("Skipped space checking under native Windows.\n");
	}
	control->fd_out = fd_out;
	control->fd_hist = fd_hist;

	if (NO_MD5)
		print_verbose("Not performing MD5 hash check\n");
	if (HAS_MD5)
		print_verbose("MD5 ");
	else
		print_verbose("CRC32 ");
	print_verbose("being used for integrity testing.\n");

	if (ENCRYPT)
		if (unlikely(!get_hash(control, 0)))
			return false;

	print_output("Decompressing...\n");

	if (unlikely(runzip_fd(control, fd_in, fd_hist, expected_size) < 0)) {
		clear_rulist(control);
		return false;
	}

	/* We can now safely delete sinfo and pthread data of all threads
	 * created. */
	clear_rulist(control);

	/* if we get here, no fatal_return(( errors during decompression */
	print_progress("\r");
	if (!(STDOUT | TEST_ONLY))
		print_output("Output filename is: %s: ", control->outfile);
	if (!expected_size)
		expected_size = control->st_size;
	if (!ENCRYPT)
		print_output("[OK] - %lld bytes                                \n", expected_size);
	else
		print_output("[OK]                                             \n");

	if (TMP_OUTBUF)
		close_tmpoutbuf(control);

	if (fd_out > 0) {
		if (unlikely(close(fd_hist) || close(fd_out)))
			fatal_return(("Failed to close files\n"), false);
	}

	if (unlikely(!STDIN && !STDOUT && !TEST_ONLY && !preserve_times(control, fd_in)))
		return false;

	if ( ! IS_FROM_FILE ) {
		close(fd_in);
	}

	if (!KEEP_FILES && !STDIN) {
		if (unlikely(unlink(control->infile)))
			fatal_return(("Failed to unlink %s\n", infilecopy), false);
	}

	if (ENCRYPT)
		release_hashes(control);

	dealloc(control->outfile);
	return true;
}

bool get_header_info(rzip_control *control, int fd_in, uchar *ctype, i64 *c_len,
		     i64 *u_len, i64 *last_head, int chunk_bytes)
{
	if (unlikely(read(fd_in, ctype, 1) != 1))
		fatal_return(("Failed to read in get_header_info\n"), false);

	*c_len = *u_len = *last_head = 0;
	if (control->major_version == 0 && control->minor_version < 4) {
		u32 c_len32, u_len32, last_head32;

		if (unlikely(read(fd_in, &c_len32, 4) != 4))
			fatal_return(("Failed to read in get_header_info"), false);
		if (unlikely(read(fd_in, &u_len32, 4) != 4))
			fatal_return(("Failed to read in get_header_info"), false);
		if (unlikely(read(fd_in, &last_head32, 4) != 4))
			fatal_return(("Failed to read in get_header_info"), false);
		c_len32 = le32toh(c_len32);
		u_len32 = le32toh(u_len32);
		last_head32 = le32toh(last_head32);
		*c_len = c_len32;
		*u_len = u_len32;
		*last_head = last_head32;
	} else {
		int read_len;

		if (control->major_version == 0 && control->minor_version == 5)
			read_len = 8;
		else
			read_len = chunk_bytes;
		if (unlikely(read(fd_in, c_len, read_len) != read_len))
			fatal_return(("Failed to read in get_header_info"), false);
		if (unlikely(read(fd_in, u_len, read_len) != read_len))
			fatal_return(("Failed to read in get_header_info"), false);
		if (unlikely(read(fd_in, last_head, read_len) != read_len))
			fatal_return(("Failed to read_i64 in get_header_info"), false);
		*c_len = le64toh(*c_len);
		*u_len = le64toh(*u_len);
		*last_head = le64toh(*last_head);
	}
	return true;
}

static double percentage(i64 num, i64 den)
{
	double d_num, d_den;

	if (den < 100) {
		d_num = num * 100;
		d_den = den;
		if (!d_den)
			d_den = 1;
	} else {
		d_num = num;
		d_den = den / 100;
	}
	return d_num / d_den;
}

bool get_fileinfo(rzip_control *control)
{
	i64 u_len, c_len, second_last, last_head, utotal = 0, ctotal = 0, ofs = 25, stream_head[2];
	i64 expected_size, infile_size, chunk_size = 0, chunk_total = 0;
	int header_length, stream = 0, chunk = 0;
	char *tmp, *infilecopy = NULL;
	char chunk_byte = 0;
	long double cratio;
	uchar ctype = 0;
	uchar save_ctype = 255;
	struct stat st;
	int fd_in;

	if (!STDIN) {
		struct stat fdin_stat;

		stat(control->infile, &fdin_stat);
		if (!S_ISREG(fdin_stat.st_mode) && (tmp = strrchr(control->infile, '.')) &&
		    strcmp(tmp,control->suffix)) {
			infilecopy = alloca(strlen(control->infile) + strlen(control->suffix) + 1);
			strcpy(infilecopy, control->infile);
			strcat(infilecopy, control->suffix);
		} else
			infilecopy = strdupa(control->infile);
	}

	if ( IS_FROM_FILE )
		fd_in = fileno(control->inFILE);
	else if (STDIN)
		fd_in = 0;
	else {
		fd_in = open(infilecopy, O_BINARY | O_RDONLY);
		if (unlikely(fd_in == -1))
			fatal_return(("Failed to open %s\n", infilecopy), false);
	}

	/* Get file size */
	if (unlikely(fstat(fd_in, &st)))
		fatal_goto(("bad magic file descriptor!?\n"), error);
	infile_size = st.st_size;

	/* Get decompressed size */
	if (unlikely(!read_magic(control, fd_in, &expected_size)))
		goto error;

	if (ENCRYPT) {
		print_output("Encrypted lrzip archive. No further information available\n");
		if (!STDIN && !IS_FROM_FILE)
			close(fd_in);
		goto out;
	}

	if (control->major_version == 0 && control->minor_version > 4) {
		if (unlikely(read(fd_in, &chunk_byte, 1) != 1))
			fatal_goto(("Failed to read chunk_byte in get_fileinfo\n"), error);
		if (unlikely(chunk_byte < 1 || chunk_byte > 8))
			fatal_goto(("Invalid chunk bytes %d\n", chunk_byte), error);
		if (control->major_version == 0 && control->minor_version > 5) {
			if (unlikely(read(fd_in, &control->eof, 1) != 1))
				fatal_goto(("Failed to read eof in get_fileinfo\n"), error);
			if (unlikely(read(fd_in, &chunk_size, chunk_byte) != chunk_byte))
				fatal_goto(("Failed to read chunk_size in get_fileinfo\n"), error);
			chunk_size = le64toh(chunk_size);
			if (unlikely(chunk_size < 0))
				fatal_goto(("Invalid chunk size %lld\n", chunk_size), error);
		}
	}

	if (control->major_version == 0 && control->minor_version < 4) {
		ofs = 24;
		header_length = 13;
	} else if (control->major_version == 0 && control->minor_version == 4) {
		ofs = 24;
		header_length = 25;
	} else if (control->major_version == 0 && control->minor_version == 5) {
		ofs = 25;
		header_length = 25;
	} else {
		ofs = 26 + chunk_byte;
		header_length = 1 + (chunk_byte * 3);
	}
	if (control->major_version == 0 && control->minor_version < 6 &&
		!expected_size)
			goto done;
next_chunk:
	stream = 0;
	stream_head[0] = 0;
	stream_head[1] = stream_head[0] + header_length;

	print_verbose("Rzip chunk:       %d\n", ++chunk);
	if (chunk_byte)
		print_verbose("Chunk byte width: %d\n", chunk_byte);
	if (chunk_size) {
		chunk_total += chunk_size;
		print_verbose("Chunk size:       %"PRId64"\n", chunk_size);
	}
	if (unlikely(chunk_byte && (chunk_byte > 8 || chunk_size < 0)))
		failure("Invalid chunk data\n");
	while (stream < NUM_STREAMS) {
		int block = 1;

		second_last = 0;
		if (unlikely(lseek(fd_in, stream_head[stream] + ofs, SEEK_SET) == -1))
			fatal_goto(("Failed to seek to header data in get_fileinfo\n"), error);
		if (unlikely(!get_header_info(control, fd_in, &ctype, &c_len, &u_len, &last_head, chunk_byte)))
			return false;

		print_verbose("Stream: %d\n", stream);
		print_maxverbose("Offset: %"PRId64"\n", stream_head[stream] + ofs);
		print_verbose("%s\t%s\t%s\t%16s / %14s", "Block","Comp","Percent","Comp Size", "UComp Size");
		print_maxverbose("%18s : %14s", "Offset", "Head");
		print_verbose("\n");
		do {
			i64 head_off;

			if (unlikely(last_head && last_head <= second_last))
				failure_goto(("Invalid earlier last_head position, corrupt archive.\n"), error);
			second_last = last_head;
			if (unlikely(last_head + ofs > infile_size))
				failure_goto(("Offset greater than archive size, likely corrupted/truncated archive.\n"), error);
			if (unlikely((head_off = lseek(fd_in, last_head + ofs, SEEK_SET)) == -1))
				fatal_goto(("Failed to seek to header data in get_fileinfo\n"), error);
			if (unlikely(!get_header_info(control, fd_in, &ctype, &c_len, &u_len,
					&last_head, chunk_byte)))
				return false;
			if (unlikely(last_head < 0 || c_len < 0 || u_len < 0))
				failure_goto(("Entry negative, likely corrupted archive.\n"), error);
			print_verbose("%d\t", block);
			if (ctype == CTYPE_NONE)
				print_verbose("none");
			else if (ctype == CTYPE_BZIP2)
				print_verbose("bzip2");
			else if (ctype == CTYPE_LZO)
				print_verbose("lzo");
			else if (ctype == CTYPE_LZMA)
				print_verbose("lzma");
			else if (ctype == CTYPE_GZIP)
				print_verbose("gzip");
			else if (ctype == CTYPE_ZPAQ)
				print_verbose("zpaq");
			else
				print_verbose("Dunno wtf");
			if (save_ctype == 255)
				save_ctype = ctype; /* need this for lzma when some chunks could have no compression
						     * and info will show rzip + none on info display if last chunk
						     * is not compressed. Adjust for all types in case it's used in
						     * the future */
			utotal += u_len;
			ctotal += c_len;
			print_verbose("\t%5.1f%%\t%16"PRId64" / %14"PRId64"", percentage(c_len, u_len), c_len, u_len);
			print_maxverbose("%18"PRId64" : %14"PRId64"", head_off, last_head);
			print_verbose("\n");
			block++;
		} while (last_head);
		++stream;
	}

	if (unlikely((ofs = lseek(fd_in, c_len, SEEK_CUR)) == -1))
		fatal_goto(("Failed to lseek c_len in get_fileinfo\n"), error);

	if (ofs >= infile_size - (HAS_MD5 ? MD5_DIGEST_SIZE : 0))
		goto done;
	/* Chunk byte entry */
	if (control->major_version == 0 && control->minor_version > 4) {
		if (unlikely(read(fd_in, &chunk_byte, 1) != 1))
			fatal_goto(("Failed to read chunk_byte in get_fileinfo\n"), error);
		if (unlikely(chunk_byte < 1 || chunk_byte > 8))
			fatal_goto(("Invalid chunk bytes %d\n", chunk_byte), error);
		ofs++;
		if (control->major_version == 0 && control->minor_version > 5) {
			if (unlikely(read(fd_in, &control->eof, 1) != 1))
				fatal_goto(("Failed to read eof in get_fileinfo\n"), error);
			if (unlikely(read(fd_in, &chunk_size, chunk_byte) != chunk_byte))
				fatal_goto(("Failed to read chunk_size in get_fileinfo\n"), error);
			chunk_size = le64toh(chunk_size);
			if (unlikely(chunk_size < 0))
				fatal_goto(("Invalid chunk size %lld\n", chunk_size), error);
			ofs += 1 + chunk_byte;
			header_length = 1 + (chunk_byte * 3);
		}
	}
	goto next_chunk;
done:
	cratio = (long double)expected_size / (long double)infile_size;
	if (unlikely(ofs > infile_size))
		failure_goto(("Offset greater than archive size, likely corrupted/truncated archive.\n"), error);
	print_output("\nSummary\n=======\n");
	print_output("File: %s\nlrzip version: %d.%d \n\n", infilecopy,
				control->major_version, control->minor_version);

	if (!expected_size)
		print_output("Due to %s, expected decompression size not available\n", "Compression to STDOUT");
	print_verbose("  Stats         Percent       Compressed /   Uncompressed\n  -------------------------------------------------------\n");
		/* If we can't show expected size, tailor output for it */
	if (expected_size) {
		print_verbose("  Rzip:         %5.1f%%\t%16"PRId64" / %14"PRId64"\n",
					percentage (utotal, expected_size),
					utotal, expected_size);
		print_verbose("  Back end:     %5.1f%%\t%16"PRId64" / %14"PRId64"\n",
					percentage(ctotal, utotal),
					ctotal, utotal);
		print_verbose("  Overall:      %5.1f%%\t%16"PRId64" / %14"PRId64"\n",
					percentage(ctotal, expected_size),
					ctotal, expected_size);
	} else {
		print_verbose("  Rzip:         Unavailable\n");
		print_verbose("  Back end:     %5.1f%%\t%16"PRId64" / %14"PRId64"\n", percentage(ctotal, utotal), ctotal, utotal);
		print_verbose("  Overall:      Unavailable\n");
	}
	print_verbose("\n");

	print_output("  Compression Method: ");

	if (save_ctype == CTYPE_NONE)
		print_output("rzip alone\n");
	else if (save_ctype == CTYPE_BZIP2)
		print_output("rzip + bzip2\n");
	else if (save_ctype == CTYPE_LZO)
		print_output("rzip + lzo\n");
	else if (save_ctype == CTYPE_LZMA)
		print_output("rzip + lzma\n");
	else if (save_ctype == CTYPE_GZIP)
		print_output("rzip + gzip\n");
	else if (save_ctype == CTYPE_ZPAQ)
		print_output("rzip + zpaq\n");
	else
		print_output("Dunno wtf\n");

	print_output("\n");

	if (expected_size) {
		print_output("  Decompressed file size: %14"PRIu64"\n", expected_size);
		print_output("  Compressed file size:   %14"PRIu64"\n", infile_size);
		print_output("  Compression ratio:      %14.3Lfx\n", cratio);
	} else {
		print_output("  Decompressed file size:    Unavailable\n");
		print_output("  Compressed file size:   %14"PRIu64"\n", infile_size);
		print_output("  Compression ratio:         Unavailable\n");
	}
	if (HAS_MD5) {
		char md5_stored[MD5_DIGEST_SIZE];
		int i;

		if (unlikely(lseek(fd_in, -MD5_DIGEST_SIZE, SEEK_END) == -1))
			fatal_goto(("Failed to seek to md5 data in runzip_fd\n"), error);
		if (unlikely(read(fd_in, md5_stored, MD5_DIGEST_SIZE) != MD5_DIGEST_SIZE))
			fatal_goto(("Failed to read md5 data in runzip_fd\n"), error);
		print_output("\n  MD5 Checksum: ");
		for (i = 0; i < MD5_DIGEST_SIZE; i++)
			print_output("%02x", md5_stored[i] & 0xFF);
		print_output("\n");
	} else
		print_output("\n  CRC32 used for integrity testing\n");
	if ( !IS_FROM_FILE )
		if (unlikely(close(fd_in)))
			fatal_return(("Failed to close fd_in in get_fileinfo\n"), false);

out:
	dealloc(control->outfile);
	return true;
error:
	if (!STDIN && ! IS_FROM_FILE) close(fd_in);
	return false;
}

/*
  compress one file from the command line
*/
bool compress_file(rzip_control *control)
{
	const char *tmp, *tmpinfile; 	/* we're just using this as a proxy for control->infile.
					 * Spares a compiler warning
					 */
	int fd_in = -1, fd_out = -1;
	char header[MAGIC_LEN];

	control->flags |= FLAG_MD5;
	if (ENCRYPT)
		if (unlikely(!get_hash(control, 1)))
			return false;
	memset(header, 0, sizeof(header));

	if ( IS_FROM_FILE )
		fd_in = fileno(control->inFILE);
	else if (!STDIN) {
		 /* is extension at end of infile? */
		if ((tmp = strrchr(control->infile, '.')) && !strcmp(tmp, control->suffix)) {
			print_err("%s: already has %s suffix. Skipping...\n", control->infile, control->suffix);
			return false;
		}

        fd_in = open(control->infile, O_BINARY | O_RDONLY);
		if (unlikely(fd_in == -1))
			fatal_return(("Failed to open %s\n", control->infile), false);
	} 
	else
		fd_in = 0;

	if (!STDOUT) {
		if (control->outname) {
				/* check if outname has control->suffix */
				if (*(control->suffix) == '\0') /* suffix is empty string */
					control->outfile = strdup(control->outname);
				else if ((tmp=strrchr(control->outname, '.')) && strcmp(tmp, control->suffix)) {
					control->outfile = malloc(strlen(control->outname) + strlen(control->suffix) + 1);
					if (unlikely(!control->outfile))
						fatal_goto(("Failed to allocate outfile name\n"), error);
					strcpy(control->outfile, control->outname);
					strcat(control->outfile, control->suffix);
					print_output("Suffix added to %s.\nFull pathname is: %s\n", control->outname, control->outfile);
				} else	/* no, already has suffix */
					control->outfile = strdup(control->outname);
		} else {
			/* default output name from control->infile
			 * test if outdir specified. If so, strip path from filename of
			 * control->infile
			*/
			if (control->outdir && (tmp = strrchr(control->infile, '/')))
				tmpinfile = tmp + 1;
			else
				tmpinfile = control->infile;

			control->outfile = malloc((control->outdir == NULL? 0: strlen(control->outdir)) + strlen(tmpinfile) + strlen(control->suffix) + 1);
			if (unlikely(!control->outfile))
				fatal_goto(("Failed to allocate outfile name\n"), error);

			if (control->outdir) {	/* prepend control->outdir */
				strcpy(control->outfile, control->outdir);
				strcat(control->outfile, tmpinfile);
			} else
				strcpy(control->outfile, tmpinfile);
			strcat(control->outfile, control->suffix);
			print_output("Output filename is: %s\n", control->outfile);
		}

		fd_out = open(control->outfile, O_BINARY | O_RDWR | O_CREAT | O_EXCL, 0666);
		if (FORCE_REPLACE && (-1 == fd_out) && (EEXIST == errno)) {
			if (unlikely(unlink(control->outfile)))
				fatal_goto(("Failed to unlink an existing file: %s\n", control->outfile), error);
			fd_out = open(control->outfile, O_BINARY | O_RDWR | O_CREAT | O_EXCL, 0666);
		}
		if (unlikely(fd_out == -1)) {
			/* We must ensure we don't delete a file that already
			 * exists just because we tried to create a new one */
			control->flags |= FLAG_KEEP_BROKEN;
			fatal_goto(("Failed to create %s\n", control->outfile), error);
		}
		control->fd_out = fd_out;
		if (!STDIN) {
			if (unlikely(!preserve_perms(control, fd_in, fd_out)))
				goto error;
		}
	} else {
		control->fd_out = fd_out = open_tmpoutfile(control);
		if (likely(fd_out != -1)) {
			/* Unlink temporary file as soon as possible */
			if (unlikely(unlink(control->outfile)))
				fatal_return(("Failed to unlink tmpfile: %s\n", control->outfile), false);
		}
		if (unlikely(!open_tmpoutbuf(control)))
			goto error;
	}

	/* Write zeroes to header at beginning of file */
	if (unlikely(!STDOUT && write(fd_out, header, sizeof(header)) != sizeof(header)))
		fatal_goto(("Cannot write file header\n"), error);

	rzip_fd(control, fd_in, fd_out);

	/* Write magic at end b/c lzma does not tell us properties until it is done */
	if (!STDOUT) {
		if (unlikely(!write_magic(control)))
			goto error;
	}

	if (ENCRYPT)
		release_hashes(control);

	if (unlikely(!STDIN && !STDOUT && !preserve_times(control, fd_in))) {
		fatal("Failed to preserve times on output file\n");
		goto error;
	}

	if (unlikely(close(fd_in))) {
		fatal("Failed to close fd_in\n");
		fd_in = -1;
		goto error;
	}
	if (unlikely(!STDOUT && close(fd_out)))
		fatal_return(("Failed to close fd_out\n"), false);
	if (TMP_OUTBUF)
		close_tmpoutbuf(control);

	if (!KEEP_FILES && !STDIN) {
		if (unlikely(unlink(control->infile)))
			fatal_return(("Failed to unlink %s\n", control->infile), false);
	}

	dealloc(control->outfile);
	return true;
error:
	if (! IS_FROM_FILE && STDIN && (fd_in > 0))
		close(fd_in);
	if ((!STDOUT) && (fd_out > 0))
		close(fd_out);
	return false;
}

bool initialise_control(rzip_control *control)
{
	time_t now_t, tdiff;
	char localeptr[] = "./", *eptr; /* for environment */
	size_t len;

	memset(control, 0, sizeof(rzip_control));
	control->msgout = stderr;
	control->msgerr = stderr;
	register_outputfile(control, control->msgout);
	control->flags = FLAG_SHOW_PROGRESS | FLAG_KEEP_FILES | FLAG_THRESHOLD;
	control->suffix = ".lrz";
	control->compression_level = 7;
	control->ramsize = get_ram(control);
	if (unlikely(control->ramsize == -1))
		return false;
	/* for testing single CPU */
	control->threads = get_threads();	/* get CPUs for LZMA */
	control->page_size = PAGE_SIZE;
	control->nice_val = 19;

	/* The first 5 bytes of the salt is the time in seconds.
	 * The next 2 bytes encode how many times to hash the password.
	 * The last 9 bytes are random data, making 16 bytes of salt */
	if (unlikely((now_t = time(NULL)) == ((time_t)-1)))
		fatal_return(("Failed to call time in main\n"), false);
	if (unlikely(now_t < T_ZERO)) {
		print_output("Warning your time reads before the year 2011, check your system clock\n");
		now_t = T_ZERO;
	}
	/* Workaround for CPUs no longer keeping up with Moore's law!
	 * This way we keep the magic header format unchanged. */
	tdiff = (now_t - T_ZERO) / 4;
	now_t = T_ZERO + tdiff;
	control->secs = now_t;
	control->encloops = nloops(control->secs, control->salt, control->salt + 1);
	if (unlikely(!get_rand(control, control->salt + 2, 6)))
		return false;

	/* Get Temp Dir. Try variations on canonical unix environment variable */
	eptr = getenv("TMPDIR");
	if (!eptr)
		eptr = getenv("TMP");
	if (!eptr)
		eptr = getenv("TEMPDIR");
	if (!eptr)
		eptr = getenv("TEMP");
	if (!eptr)
		eptr = localeptr;
	len = strlen(eptr);

	control->tmpdir = malloc(len + 2);
	if (control->tmpdir == NULL)
		fatal_return(("Failed to allocate for tmpdir\n"), false);
	strcpy(control->tmpdir, eptr);
	if (control->tmpdir[len - 1] != '/') {
		control->tmpdir[len] = '/'; /* need a trailing slash */
		control->tmpdir[len + 1] = '\0';
	}
	return true;
}
