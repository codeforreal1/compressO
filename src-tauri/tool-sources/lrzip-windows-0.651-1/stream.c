/*
   Copyright (C) 2006-2016,2018,2021-2022 Con Kolivas
   Copyright (C) 2011 Serge Belyshev
   Copyright (C) 2011 Peter Hyman
   Copyright (C) 1998 Andrew Tridgell

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
/* multiplex N streams into a file - the streams are passed
   through different compressors */

#ifdef HAVE_CONFIG_H
# include "config.h"
#endif

#ifdef HAVE_SYS_TIME_H
# include <sys/time.h>
#endif
#ifdef HAVE_SYS_TYPES_H
# include <sys/types.h>
#endif
#ifdef HAVE_SYS_RESOURCE_H
# include <sys/resource.h>
#endif
#ifdef HAVE_UNISTD_H
# include <unistd.h>
#endif
#include <pthread.h>
#include <bzlib.h>
#include <zlib.h>
#include <lzo/lzoconf.h>
#include <lzo/lzo1x.h>
#include <lz4.h>
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

/* LZMA C Wrapper */
#include "lzma/C/LzmaLib.h"

#include "util.h"
#include "lrzip_core.h"

#define STREAM_BUFSIZE (1024 * 1024 * 10)

static struct compress_thread {
	uchar *s_buf;	/* Uncompressed buffer -> Compressed buffer */
	uchar c_type;	/* Compression type */
	i64 s_len;	/* Data length uncompressed */
	i64 c_len;	/* Data length compressed */
	cksem_t cksem;  /* This thread's semaphore */
	struct stream_info *sinfo;
	int streamno;
	uchar salt[SALT_LEN];
} *cthreads;

typedef struct stream_thread_struct {
	int i;
	rzip_control *control;
	struct stream_info *sinfo;
} stream_thread_struct;

static long output_thread;
static pthread_mutex_t output_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t output_cond = PTHREAD_COND_INITIALIZER;

bool init_mutex(rzip_control *control, pthread_mutex_t *mutex)
{
	if (unlikely(pthread_mutex_init(mutex, NULL)))
		fatal_return(("Failed to pthread_mutex_init\n"), false);
	return true;
}

bool unlock_mutex(rzip_control *control, pthread_mutex_t *mutex)
{
	if (unlikely(pthread_mutex_unlock(mutex)))
		fatal_return(("Failed to pthread_mutex_unlock\n"), false);
	return true;
}

bool lock_mutex(rzip_control *control, pthread_mutex_t *mutex)
{
	int ret = pthread_mutex_lock(mutex);

	// See https://stackoverflow.com/questions/30511046/pthread-mutex-lock-returns-22-in-c
	if (!ret || !(pthread_mutex_init(mutex, 0), pthread_mutex_lock(mutex)))
		return true;
	fatal_return(("Failed to pthread_mutex_lock\n"), false);
}

static bool cond_wait(rzip_control *control, pthread_cond_t *cond, pthread_mutex_t *mutex)
{
	if (unlikely(pthread_cond_wait(cond, mutex)))
		fatal_return(("Failed to pthread_cond_wait\n"), false);
	return true;
}

static bool cond_broadcast(rzip_control *control, pthread_cond_t *cond)
{
	if (unlikely(pthread_cond_broadcast(cond)))
		fatal_return(("Failed to pthread_cond_broadcast\n"), false);
	return true;
}

bool create_pthread(rzip_control *control, pthread_t *thread, pthread_attr_t * attr,
	void * (*start_routine)(void *), void *arg)
{
	if (unlikely(pthread_create(thread, attr, start_routine, arg)))
		fatal_return(("Failed to pthread_create\n"), false);
	return true;
}

bool detach_pthread(rzip_control *control, pthread_t *thread)
{
	if (unlikely(pthread_detach(*thread)))
		fatal_return(("Failed to pthread_detach\n"), false);
	return true;
}

bool join_pthread(rzip_control *control, pthread_t th, void **thread_return)
{
	if (pthread_join(th, thread_return))
		fatal_return(("Failed to pthread_join\n"), false);
	return true;
}

/* just to keep things clean, declare function here
 * but move body to the end since it's a work function
*/
static int lz4_compresses(rzip_control *control, uchar *s_buf, i64 s_len);

/*
  ***** COMPRESSION FUNCTIONS *****

  ZPAQ, BZIP, GZIP, LZMA, LZO

  try to compress a buffer. If compression fails for whatever reason then
  leave uncompressed. Return the compression type in c_type and resulting
  length in c_len
*/

static int zpaq_compress_buf(rzip_control *control, struct compress_thread *cthread, long thread)
{
	i64 c_len, c_size;
	uchar *c_buf;

	if (!lz4_compresses(control, cthread->s_buf, cthread->s_len))
		return 0;

	c_size = round_up_page(control, cthread->s_len + 10000);
	c_buf = malloc(c_size);
	if (!c_buf) {
		print_err("Unable to allocate c_buf in zpaq_compress_buf\n");
		return -1;
	}

	c_len = 0;

	zpaq_compress(c_buf, &c_len, cthread->s_buf, cthread->s_len, control->compression_level / 4 + 1,
		      control->msgout, SHOW_PROGRESS ? true: false, thread);

	if (unlikely(c_len >= cthread->c_len)) {
		print_maxverbose("Incompressible block\n");
		/* Incompressible, leave as CTYPE_NONE */
		dealloc(c_buf);
		return 0;
	}

	cthread->c_len = c_len;
	dealloc(cthread->s_buf);
	cthread->s_buf = c_buf;
	cthread->c_type = CTYPE_ZPAQ;
	return 0;
}

static int bzip2_compress_buf(rzip_control *control, struct compress_thread *cthread)
{
	u32 dlen = round_up_page(control, cthread->s_len);
	int bzip2_ret;
	uchar *c_buf;

	if (!lz4_compresses(control, cthread->s_buf, cthread->s_len))
		return 0;

	c_buf = malloc(dlen);
	if (!c_buf) {
		print_err("Unable to allocate c_buf in bzip2_compress_buf\n");
		return -1;
	}

	bzip2_ret = BZ2_bzBuffToBuffCompress((char *)c_buf, &dlen,
		(char *)cthread->s_buf, cthread->s_len,
		control->compression_level, 0, control->compression_level * 10);

	/* if compressed data is bigger then original data leave as
	 * CTYPE_NONE */

	if (bzip2_ret == BZ_OUTBUFF_FULL) {
		print_maxverbose("Incompressible block\n");
		/* Incompressible, leave as CTYPE_NONE */
		dealloc(c_buf);
		return 0;
	}

	if (unlikely(bzip2_ret != BZ_OK)) {
		dealloc(c_buf);
		print_maxverbose("BZ2 compress failed\n");
		return -1;
	}

	if (unlikely(dlen >= cthread->c_len)) {
		print_maxverbose("Incompressible block\n");
		/* Incompressible, leave as CTYPE_NONE */
		dealloc(c_buf);
		return 0;
	}

	cthread->c_len = dlen;
	dealloc(cthread->s_buf);
	cthread->s_buf = c_buf;
	cthread->c_type = CTYPE_BZIP2;
	return 0;
}

static int gzip_compress_buf(rzip_control *control, struct compress_thread *cthread)
{
	unsigned long dlen = round_up_page(control, cthread->s_len);
	uchar *c_buf;
	int gzip_ret;

	c_buf = malloc(dlen);
	if (!c_buf) {
		print_err("Unable to allocate c_buf in gzip_compress_buf\n");
		return -1;
	}

	gzip_ret = compress2(c_buf, &dlen, cthread->s_buf, cthread->s_len,
		control->compression_level);

	/* if compressed data is bigger then original data leave as
	 * CTYPE_NONE */

	if (gzip_ret == Z_BUF_ERROR) {
		print_maxverbose("Incompressible block\n");
		/* Incompressible, leave as CTYPE_NONE */
		dealloc(c_buf);
		return 0;
	}

	if (unlikely(gzip_ret != Z_OK)) {
		dealloc(c_buf);
		print_maxverbose("compress2 failed\n");
		return -1;
	}

	if (unlikely((i64)dlen >= cthread->c_len)) {
		print_maxverbose("Incompressible block\n");
		/* Incompressible, leave as CTYPE_NONE */
		dealloc(c_buf);
		return 0;
	}

	cthread->c_len = dlen;
	dealloc(cthread->s_buf);
	cthread->s_buf = c_buf;
	cthread->c_type = CTYPE_GZIP;
	return 0;
}

static int lzma_compress_buf(rzip_control *control, struct compress_thread *cthread)
{
	unsigned char lzma_properties[5]; /* lzma properties, encoded */
	int lzma_level, lzma_ret;
	size_t prop_size = 5; /* return value for lzma_properties */
	uchar *c_buf;
	size_t dlen;

	if (!lz4_compresses(control, cthread->s_buf, cthread->s_len))
		return 0;

	/* only 7 levels with lzma, scale them */
	lzma_level = control->compression_level * 7 / 9;
	if (!lzma_level)
		lzma_level = 1;

	print_maxverbose("Starting lzma back end compression thread...\n");
retry:
	dlen = round_up_page(control, cthread->s_len);
	c_buf = malloc(dlen);
	if (!c_buf) {
		print_err("Unable to allocate c_buf in lzma_compress_buf\n");
		return -1;
	}

	/* with LZMA SDK 4.63, we pass compression level and threads only
	 * and receive properties in lzma_properties */

	lzma_ret = LzmaCompress(c_buf, &dlen, cthread->s_buf,
		(size_t)cthread->s_len, lzma_properties, &prop_size,
				lzma_level,
				0, /* dict size. set default, choose by level */
				-1, -1, -1, -1, /* lc, lp, pb, fb */
				control->threads > 1 ? 2: 1);
				/* LZMA spec has threads = 1 or 2 only. */
	if (lzma_ret != SZ_OK) {
		switch (lzma_ret) {
			case SZ_ERROR_MEM:
				break;
			case SZ_ERROR_PARAM:
				print_err("LZMA Parameter ERROR: %d. This should not happen.\n", SZ_ERROR_PARAM);
				break;
			case SZ_ERROR_OUTPUT_EOF:
				print_maxverbose("Harmless LZMA Output Buffer Overflow error: %d. Incompressible block.\n", SZ_ERROR_OUTPUT_EOF);
				break;
			case SZ_ERROR_THREAD:
				print_err("LZMA Multi Thread ERROR: %d. This should not happen.\n", SZ_ERROR_THREAD);
				break;
			default:
				print_err("Unidentified LZMA ERROR: %d. This should not happen.\n", lzma_ret);
				break;
		}
		/* can pass -1 if not compressible! Thanks Lasse Collin */
		dealloc(c_buf);
		if (lzma_ret == SZ_ERROR_MEM) {
			if (lzma_level > 1) {
				lzma_level--;
				print_verbose("LZMA Warning: %d. Can't allocate enough RAM for compression window, trying smaller.\n", SZ_ERROR_MEM);
				goto retry;
			}
			/* lzma compress can be fragile on 32 bit. If it fails,
			 * fall back to bzip2 compression so the block doesn't
			 * remain uncompressed */
			print_verbose("Unable to allocate enough RAM for any sized compression window, falling back to bzip2 compression.\n");
			return bzip2_compress_buf(control, cthread);
		} else if (lzma_ret == SZ_ERROR_OUTPUT_EOF)
			return 0;
		return -1;
	}

	if (unlikely((i64)dlen >= cthread->c_len)) {
		/* Incompressible, leave as CTYPE_NONE */
		print_maxverbose("Incompressible block\n");
		dealloc(c_buf);
		return 0;
	}

	/* Make sure multiple threads don't race on writing lzma_properties */
	lock_mutex(control, &control->control_lock);
	if (!control->lzma_prop_set) {
		memcpy(control->lzma_properties, lzma_properties, 5);
		control->lzma_prop_set = true;
		/* Reset the magic written flag so we write it again if we
		 * get lzma properties and haven't written them yet. */
		if (TMP_OUTBUF)
			control->magic_written = 0;
	}
	unlock_mutex(control, &control->control_lock);

	cthread->c_len = dlen;
	dealloc(cthread->s_buf);
	cthread->s_buf = c_buf;
	cthread->c_type = CTYPE_LZMA;
	return 0;
}

static int lzo_compress_buf(rzip_control *control, struct compress_thread *cthread)
{
	lzo_uint in_len = cthread->s_len;
	lzo_uint dlen = round_up_page(control, in_len + in_len / 16 + 64 + 3);
	lzo_bytep wrkmem;
	uchar *c_buf;
	int ret = -1;

	wrkmem = (lzo_bytep) calloc(1, LZO1X_1_MEM_COMPRESS);
	if (unlikely(wrkmem == NULL)) {
		print_maxverbose("Failed to malloc wkmem\n");
		return ret;
	}

	c_buf = malloc(dlen);
	if (!c_buf) {
		print_err("Unable to allocate c_buf in lzo_compress_buf");
		goto out_free;
	}

	/* lzo1x_1_compress does not return anything but LZO_OK so we ignore
	 * the return value */
	lzo1x_1_compress(cthread->s_buf, in_len, c_buf, &dlen, wrkmem);
	ret = 0;

	if (dlen >= in_len){
		/* Incompressible, leave as CTYPE_NONE */
		print_maxverbose("Incompressible block\n");
		dealloc(c_buf);
		goto out_free;
	}

	cthread->c_len = dlen;
	dealloc(cthread->s_buf);
	cthread->s_buf = c_buf;
	cthread->c_type = CTYPE_LZO;
out_free:
	dealloc(wrkmem);
	return ret;
}

/*
  ***** DECOMPRESSION FUNCTIONS *****

  ZPAQ, BZIP, GZIP, LZMA, LZO

  try to decompress a buffer. Return 0 on success and -1 on failure.
*/
static int zpaq_decompress_buf(rzip_control *control __UNUSED__, struct uncomp_thread *ucthread, long thread)
{
	i64 dlen = ucthread->u_len;
	uchar *c_buf;
	int ret = 0;

	c_buf = ucthread->s_buf;
	ucthread->s_buf = malloc(round_up_page(control, dlen));
	if (unlikely(!ucthread->s_buf)) {
		print_err("Failed to allocate %ld bytes for decompression\n", dlen);
		ret = -1;
		goto out;
	}

	dlen = 0;
	zpaq_decompress(ucthread->s_buf, &dlen, c_buf, ucthread->c_len,
			control->msgout, SHOW_PROGRESS ? true: false, thread);

	if (unlikely(dlen != ucthread->u_len)) {
		print_err("Inconsistent length after decompression. Got %ld bytes, expected %lld\n", dlen, ucthread->u_len);
		ret = -1;
	} else
		dealloc(c_buf);
out:
	if (ret == -1) {
		dealloc(ucthread->s_buf);
		ucthread->s_buf = c_buf;
	}
	return ret;
}

static int bzip2_decompress_buf(rzip_control *control __UNUSED__, struct uncomp_thread *ucthread)
{
	u32 dlen = ucthread->u_len;
	int ret = 0, bzerr;
	uchar *c_buf;

	c_buf = ucthread->s_buf;
	ucthread->s_buf = malloc(round_up_page(control, dlen));
	if (unlikely(!ucthread->s_buf)) {
		print_err("Failed to allocate %d bytes for decompression\n", dlen);
		ret = -1;
		goto out;
	}

	bzerr = BZ2_bzBuffToBuffDecompress((char*)ucthread->s_buf, &dlen, (char*)c_buf, ucthread->c_len, 0, 0);
	if (unlikely(bzerr != BZ_OK)) {
		print_err("Failed to decompress buffer - bzerr=%d\n", bzerr);
		ret = -1;
		goto out;
	}

	if (unlikely(dlen != ucthread->u_len)) {
		print_err("Inconsistent length after decompression. Got %d bytes, expected %lld\n", dlen, ucthread->u_len);
		ret = -1;
	} else
		dealloc(c_buf);
out:
	if (ret == -1) {
		dealloc(ucthread->s_buf);
		ucthread->s_buf = c_buf;
	}
	return ret;
}

static int gzip_decompress_buf(rzip_control *control __UNUSED__, struct uncomp_thread *ucthread)
{
	unsigned long dlen = ucthread->u_len;
	int ret = 0, gzerr;
	uchar *c_buf;

	c_buf = ucthread->s_buf;
	ucthread->s_buf = malloc(round_up_page(control, dlen));
	if (unlikely(!ucthread->s_buf)) {
		print_err("Failed to allocate %ld bytes for decompression\n", dlen);
		ret = -1;
		goto out;
	}

	gzerr = uncompress(ucthread->s_buf, &dlen, c_buf, ucthread->c_len);
	if (unlikely(gzerr != Z_OK)) {
		print_err("Failed to decompress buffer - gzerr=%d\n", gzerr);
		ret = -1;
		goto out;
	}

	if (unlikely((i64)dlen != ucthread->u_len)) {
		print_err("Inconsistent length after decompression. Got %ld bytes, expected %lld\n", dlen, ucthread->u_len);
		ret = -1;
	} else
		dealloc(c_buf);
out:
	if (ret == -1) {
		dealloc(ucthread->s_buf);
		ucthread->s_buf = c_buf;
	}
	return ret;
}

static int lzma_decompress_buf(rzip_control *control, struct uncomp_thread *ucthread)
{
	size_t dlen = ucthread->u_len;
	int ret = 0, lzmaerr;
	uchar *c_buf;
	SizeT c_len = ucthread->c_len;

	c_buf = ucthread->s_buf;
	ucthread->s_buf = malloc(round_up_page(control, dlen));
	if (unlikely(!ucthread->s_buf)) {
		print_err("Failed to allocate %lld bytes for decompression\n", (i64)dlen);
		ret = -1;
		goto out;
	}

	/* With LZMA SDK 4.63 we pass control->lzma_properties
	 * which is needed for proper uncompress */
	lzmaerr = LzmaUncompress(ucthread->s_buf, &dlen, c_buf, &c_len, control->lzma_properties, 5);
	if (unlikely(lzmaerr)) {
		print_err("Failed to decompress buffer - lzmaerr=%d\n", lzmaerr);
		ret = -1;
		goto out;
	}

	if (unlikely((i64)dlen != ucthread->u_len)) {
		print_err("Inconsistent length after decompression. Got %lld bytes, expected %lld\n", (i64)dlen, ucthread->u_len);
		ret = -1;
	} else
		dealloc(c_buf);
out:
	if (ret == -1) {
		dealloc(ucthread->s_buf);
		ucthread->s_buf = c_buf;
	}
	return ret;
}

static int lzo_decompress_buf(rzip_control *control __UNUSED__, struct uncomp_thread *ucthread)
{
	lzo_uint dlen = ucthread->u_len;
	int ret = 0, lzerr;
	uchar *c_buf;

	c_buf = ucthread->s_buf;
	ucthread->s_buf = malloc(round_up_page(control, dlen));
	if (unlikely(!ucthread->s_buf)) {
		print_err("Failed to allocate %lu bytes for decompression\n", (unsigned long)dlen);
		ret = -1;
		goto out;
	}

	lzerr = lzo1x_decompress_safe((uchar*)c_buf, ucthread->c_len, (uchar*)ucthread->s_buf, &dlen, NULL);
	if (unlikely(lzerr != LZO_E_OK)) {
		print_err("Failed to decompress buffer - lzerr=%d\n", lzerr);
		ret = -1;
		goto out;
	}

	if (unlikely((i64)dlen != ucthread->u_len)) {
		print_err("Inconsistent length after decompression. Got %lu bytes, expected %lld\n", (unsigned long)dlen, ucthread->u_len);
		ret = -1;
	} else
		dealloc(c_buf);
out:
	if (ret == -1) {
		dealloc(ucthread->s_buf);
		ucthread->s_buf = c_buf;
	}
	return ret;
}

/* WORK FUNCTIONS */

/* Look at whether we're writing to a ram location or physical files and write
 * the data accordingly. */
ssize_t put_fdout(rzip_control *control, void *offset_buf, ssize_t ret)
{
	if (!TMP_OUTBUF)
		return write(control->fd_out, offset_buf, (size_t)ret);

	if (unlikely(control->out_ofs + ret > control->out_maxlen)) {
		/* The data won't fit in a temporary output buffer so we have
		 * to fall back to temporary files. */
		print_verbose("Unable to %scompress entirely in ram, will use physical files\n",
			      DECOMPRESS ? "de" : "");
		if (unlikely(control->fd_out == -1)) {
			failure("Was unable to %scompress entirely in ram and no temporary file creation was possible\n",
				DECOMPRESS ? "de" : "");
		}
		/* Copy tmp_outbuf to tmpoutfile before deallocation */
		if (unlikely(!write_fdout(control, control->tmp_outbuf, control->out_len))) {
			print_err("Unable to write_fdout tmpoutbuf in put_fdout\n");
			return -1;
		}
		/* Deallocate now unused tmpoutbuf and unset tmp_outbuf flag */
		close_tmpoutbuf(control);
		return write(control->fd_out, offset_buf, (size_t)ret);
	}

	memcpy(control->tmp_outbuf + control->out_ofs, offset_buf, ret);
	control->out_ofs += ret;
	if (likely(control->out_ofs > control->out_len))
		control->out_len = control->out_ofs;
	return ret;
}

/* This is a custom version of write() which writes in 1GB chunks to avoid
   the overflows at the >= 2GB mark thanks to 32bit fuckage. */
ssize_t write_1g(rzip_control *control, void *buf, i64 len)
{
	uchar *offset_buf = buf;
	ssize_t ret;
	i64 total;

	total = 0;
	while (len > 0) {
		if (BITS32)
			ret = MIN(len, one_g);
		else
			ret = len;
		ret = put_fdout(control, offset_buf, (size_t)ret);
		if (unlikely(ret <= 0))
			return ret;
		len -= ret;
		offset_buf += ret;
		total += ret;
	}
	return total;
}

/* Should be called only if we know the buffer will be large enough, otherwise
 * we must dump_stdin first */
static bool read_fdin(struct rzip_control *control, i64 len)
{
	int tmpchar;
	i64 i;

	for (i = 0; i < len; i++) {
		tmpchar = getchar();
		if (unlikely(tmpchar == EOF))
			failure_return(("Reached end of file on STDIN prematurely on read_fdin, asked for %lld got %lld\n",
				len, i), false);
		control->tmp_inbuf[control->in_ofs + i] = (char)tmpchar;
	}
	control->in_len = control->in_ofs + len;
	return true;
}

/* Dump STDIN into a temporary file */
static int dump_stdin(rzip_control *control)
{
	if (unlikely(!write_fdin(control)))
		return -1;
	if (unlikely(!read_tmpinfile(control, control->fd_in)))
		return -1;
	close_tmpinbuf(control);
	return 0;
}

/* Ditto for read */
ssize_t read_1g(rzip_control *control, int fd, void *buf, i64 len)
{
	uchar *offset_buf = buf;
	ssize_t ret;
	i64 total;

	if (TMP_INBUF && fd == control->fd_in) {
		/* We're decompressing from STDIN */
		if (unlikely(control->in_ofs + len > control->in_maxlen)) {
			/* We're unable to fit it all into the temp buffer */
			if (dump_stdin(control)) {
				failure_return(("Inadequate ram to %scompress from STDIN and unable to create in tmpfile",
					DECOMPRESS ? "de" : ""), -1);
			}
			goto read_fd;
		}
		if (control->in_ofs + len > control->in_len) {
			if (unlikely(!read_fdin(control, control->in_ofs + len - control->in_len)))
				return false;
		}
		memcpy(buf, control->tmp_inbuf + control->in_ofs, len);
		control->in_ofs += len;
		return len;
	}

	if (TMP_OUTBUF && fd == control->fd_out) {
		if (unlikely(control->out_ofs + len > control->out_maxlen))
			failure_return(("Trying to read beyond out_ofs in tmpoutbuf\n"), -1);
		memcpy(buf, control->tmp_outbuf + control->out_ofs, len);
		control->out_ofs += len;
		return len;
	}

read_fd:
	total = 0;
	while (len > 0) {
		if (BITS32)
			ret = MIN(len, one_g);
		else
			ret = len;
		ret = read(fd, offset_buf, (size_t)ret);
		if (unlikely(ret <= 0))
			return ret;
		len -= ret;
		offset_buf += ret;
		total += ret;
	}
	return total;
}

/* write to a file, return 0 on success and -1 on failure */
static int write_buf(rzip_control *control, uchar *p, i64 len)
{
	ssize_t ret;

	ret = write_1g(control, p, (size_t)len);
	if (unlikely(ret == -1)) {
		print_err("Write of length %lld failed - %s\n", len, strerror(errno));
		return -1;
	}
	if (unlikely(ret != (ssize_t)len)) {
		print_err("Partial write!? asked for %lld bytes but got %lld\n", len, (i64)ret);
		return -1;
	}
	return 0;
}

/* write a byte */
static inline int write_u8(rzip_control *control, uchar v)
{
	return write_buf(control, &v, 1);
}

static inline int write_val(rzip_control *control, i64 v, int len)
{
	v = htole64(v);
	return write_buf(control, (uchar *)&v, len);
}

static int read_buf(rzip_control *control, int f, uchar *p, i64 len)
{
	ssize_t ret;

	ret = read_1g(control, f, p, (size_t)len);
	if (unlikely(ret == -1)) {
		print_err("Read of length %lld failed - %s\n", len, strerror(errno));
		return -1;
	}
	if (unlikely(ret != (ssize_t)len)) {
		print_err("Partial read!? asked for %lld bytes but got %lld\n", len, (i64)ret);
		return -1;
	}
	return 0;
}

static inline int read_u8(rzip_control *control, int f, uchar *v)
{
	return read_buf(control, f, v, 1);
}

static inline int read_u32(rzip_control *control, int f, u32 *v)
{
	int ret = read_buf(control, f, (uchar *)v, 4);

	*v = le32toh(*v);
	return ret;
}

static inline int read_val(rzip_control *control, int f, i64 *v, int len)
{
	int ret;

	/* We only partially read all 8 bytes so have to zero v here */
	*v = 0;
	ret = read_buf(control, f, (uchar *)v, len);
	return ret;
}

static int fd_seekto(rzip_control *control, struct stream_info *sinfo, i64 spos, i64 pos)
{
	if (unlikely(lseek(sinfo->fd, spos, SEEK_SET) != spos)) {
		print_err("Failed to seek to %lld in stream\n", pos);
		return -1;
	}
	return 0;
}

/* seek to a position within a set of streams - return -1 on failure */
static int seekto(rzip_control *control, struct stream_info *sinfo, i64 pos)
{
	i64 spos = pos + sinfo->initial_pos;

	if (TMP_OUTBUF) {
		spos -= control->out_relofs;
		control->out_ofs = spos;
		if (unlikely(spos > control->out_len || spos < 0)) {
			print_err("Trying to seek to %lld outside tmp outbuf in seekto\n", spos);
			return -1;
		}
		return 0;
	}

	return fd_seekto(control, sinfo, spos, pos);
}

static int read_seekto(rzip_control *control, struct stream_info *sinfo, i64 pos)
{
	i64 spos = pos + sinfo->initial_pos;

	if (TMP_INBUF) {
		if (spos > control->in_len) {
			i64 len = spos - control->in_len;

			if (control->in_ofs + len > control->in_maxlen) {
				if (unlikely(dump_stdin(control)))
					return -1;
				goto fd_seek;
			} else {
				if (unlikely(!read_fdin(control, len)))
					return -1;
			}
		}
		control->in_ofs = spos;
		if (unlikely(spos < 0)) {
			print_err("Trying to seek to %lld outside tmp inbuf in read_seekto\n", spos);
			return -1;
		}
		return 0;
	}
fd_seek:
	return fd_seekto(control, sinfo, spos, pos);
}

static i64 get_seek(rzip_control *control, int fd)
{
	i64 ret;

	if (TMP_OUTBUF)
		return control->out_relofs + control->out_ofs;
	ret = lseek(fd, 0, SEEK_CUR);
	if (unlikely(ret == -1))
		fatal_return(("Failed to lseek in get_seek\n"), -1);
	return ret;
}

i64 get_readseek(rzip_control *control, int fd)
{
	i64 ret;

	if (TMP_INBUF)
		return control->in_ofs;
	ret = lseek(fd, 0, SEEK_CUR);
	if (unlikely(ret == -1))
		fatal_return(("Failed to lseek in get_seek\n"), -1);
	return ret;
}

bool prepare_streamout_threads(rzip_control *control)
{
	pthread_t *threads;
	int i;

	/* As we serialise the generation of threads during the rzip
	 * pre-processing stage, it's faster to have one more thread available
	 * to keep all CPUs busy. There is no point splitting up the chunks
	 * into multiple threads if there will be no compression back end. */
	if (control->threads > 1)
		++control->threads;
	if (NO_COMPRESS)
		control->threads = 1;
	threads = control->pthreads = calloc(sizeof(pthread_t), control->threads);
	if (unlikely(!threads))
		fatal_return(("Unable to calloc threads in prepare_streamout_threads\n"), false);

	cthreads = calloc(sizeof(struct compress_thread), control->threads);
	if (unlikely(!cthreads)) {
		dealloc(threads);
		fatal_return(("Unable to calloc cthreads in prepare_streamout_threads\n"), false);
	}

	for (i = 0; i < control->threads; i++) {
		cksem_init(control, &cthreads[i].cksem);
		cksem_post(control, &cthreads[i].cksem);
	}
	return true;
}


bool close_streamout_threads(rzip_control *control)
{
	int i, close_thread = output_thread;

	/* Wait for the threads in the correct order in case they end up
	 * serialised */
	for (i = 0; i < control->threads; i++) {
		cksem_wait(control, &cthreads[close_thread].cksem);

		if (++close_thread == control->threads)
			close_thread = 0;
	}
	dealloc(cthreads);
	dealloc(control->pthreads);
	return true;
}

/* open a set of output streams, compressing with the given
   compression level and algorithm */
void *open_stream_out(rzip_control *control, int f, unsigned int n, i64 chunk_limit, char cbytes)
{
	struct stream_info *sinfo;
	unsigned int i, testbufs;
	bool threadlimit = false;
	i64 testsize, limit;
	uchar *testmalloc;

	sinfo = calloc(sizeof(struct stream_info), 1);
	if (unlikely(!sinfo))
		return NULL;
	if (chunk_limit < control->page_size)
		chunk_limit = control->page_size;
	sinfo->bufsize = sinfo->size = limit = chunk_limit;

	sinfo->chunk_bytes = cbytes;
	sinfo->num_streams = n;
	sinfo->fd = f;

	sinfo->s = calloc(sizeof(struct stream), n);
	if (unlikely(!sinfo->s)) {
		dealloc(sinfo);
		return NULL;
	}

	/* Find the largest we can make the window based on ability to malloc
	 * ram. We need 2 buffers for each compression thread and the overhead
	 * of each compression back end. No 2nd buf is required when there is
	 * no back end compression. We limit the total regardless to 1/3 ram
	 * for when the OS lies due to heavy overcommit. */
	if (NO_COMPRESS)
		testbufs = 1;
	else
		testbufs = 2;

	testsize = (limit * testbufs) + (control->overhead * control->threads);
	if (testsize > control->usable_ram)
		limit = (control->usable_ram - (control->overhead * control->threads)) / testbufs;

	/* If we don't have enough ram for the number of threads, decrease the
	 * number of threads till we do, or only have one thread. */
	while (limit < STREAM_BUFSIZE && limit < chunk_limit) {
		if (control->threads > 1) {
			--control->threads;
			threadlimit = true;
		} else
			break;
		limit = (control->usable_ram - (control->overhead * control->threads)) / testbufs;
		limit = MIN(limit, chunk_limit);
	}
	if (threadlimit) {
		print_output("Minimising number of threads to %d to limit memory usage\n",
			     control->threads);
	}
	if (BITS32) {
		limit = MIN(limit, one_g);
		if (limit + (control->overhead * control->threads) > one_g)
			limit = one_g - (control->overhead * control->threads);
	}
	/* Use a nominal minimum size should we fail all previous shrinking */
	if (limit < STREAM_BUFSIZE) {
		limit = MAX(limit, STREAM_BUFSIZE);
		print_output("Warning, low memory for chosen compression settings\n");
	}
	limit = MIN(limit, chunk_limit);
retest_malloc:
	testsize = limit + (control->overhead * control->threads);
	testmalloc = malloc(testsize);
	if (!testmalloc) {
		limit = limit / 10 * 9;
		if (limit < 100000000) {
			/* If we can't even allocate 100MB then we'll never
			 * succeed */
			print_err("Unable to allocate enough memory for operation\n");
			dealloc(sinfo->s);
			dealloc(sinfo);
			return NULL;
		}
		goto retest_malloc;
	}
	if (!NO_COMPRESS) {
		char *testmalloc2 = malloc(limit);

		if (!testmalloc2) {
			dealloc(testmalloc);
			limit = limit / 10 * 9;
			goto retest_malloc;
		}
		dealloc(testmalloc2);
	}
	dealloc(testmalloc);
	print_maxverbose("Succeeded in testing %lld sized malloc for back end compression\n", testsize);

	/* Make the bufsize no smaller than STREAM_BUFSIZE. Round up the
	 * bufsize to fit X threads into it */
	sinfo->bufsize = MIN(limit, MAX((limit + control->threads - 1) / control->threads,
					STREAM_BUFSIZE));

	if (control->threads > 1)
		print_maxverbose("Using up to %d threads to compress up to %lld bytes each.\n",
			control->threads, sinfo->bufsize);
	else
		print_maxverbose("Using only 1 thread to compress up to %lld bytes\n",
			sinfo->bufsize);

	for (i = 0; i < n; i++) {
		sinfo->s[i].buf = calloc(sinfo->bufsize , 1);
		if (unlikely(!sinfo->s[i].buf)) {
			fatal("Unable to malloc buffer of size %lld in open_stream_out\n", sinfo->bufsize);
			dealloc(sinfo->s);
			dealloc(sinfo);
			return NULL;
		}
	}

	return (void *)sinfo;
}

/* The block headers are all encrypted so we read the data and salt associated
 * with them, decrypt the data, then return the decrypted version of the
 * values */
static bool decrypt_header(rzip_control *control, uchar *head, uchar *c_type,
			   i64 *c_len, i64 *u_len, i64 *last_head)
{
	uchar *buf = head + SALT_LEN;

	memcpy(buf, c_type, 1);
	memcpy(buf + 1, c_len, 8);
	memcpy(buf + 9, u_len, 8);
	memcpy(buf + 17, last_head, 8);

	if (unlikely(!lrz_decrypt(control, buf, 25, head)))
		return false;

	memcpy(c_type, buf, 1);
	memcpy(c_len, buf + 1, 8);
	memcpy(u_len, buf + 9, 8);
	memcpy(last_head, buf + 17, 8);
	return true;
}

/* prepare a set of n streams for reading on file descriptor f */
void *open_stream_in(rzip_control *control, int f, int n, char chunk_bytes)
{
	struct uncomp_thread *ucthreads;
	struct stream_info *sinfo;
	int total_threads, i;
	pthread_t *threads;
	i64 header_length;

	sinfo = calloc(sizeof(struct stream_info), 1);
	if (unlikely(!sinfo))
		return NULL;

	/* We have one thread dedicated to stream 0, and one more thread than
	 * CPUs to keep them busy, unless we're running single-threaded. */
	if (control->threads > 1)
		total_threads = control->threads + 2;
	else
		total_threads = control->threads + 1;
	threads = control->pthreads = calloc(sizeof(pthread_t), total_threads);
	if (unlikely(!threads))
		return NULL;

	sinfo->ucthreads = ucthreads = calloc(sizeof(struct uncomp_thread), total_threads);
	if (unlikely(!ucthreads)) {
		dealloc(sinfo);
		dealloc(threads);
		fatal_return(("Unable to calloc ucthreads in open_stream_in\n"), NULL);
	}

	sinfo->num_streams = n;
	sinfo->fd = f;
	sinfo->chunk_bytes = chunk_bytes;

	sinfo->s = calloc(sizeof(struct stream), n);
	if (unlikely(!sinfo->s)) {
		dealloc(sinfo);
		dealloc(threads);
		dealloc(ucthreads);
		return NULL;
	}

	sinfo->s[0].total_threads = 1;
	sinfo->s[1].total_threads = total_threads - 1;

	if (control->major_version == 0 && control->minor_version > 5) {
		/* Read in flag that tells us if there are more chunks after
		 * this. Ignored if we know the final file size */
		print_maxverbose("Reading eof flag at %lld\n", get_readseek(control, f));
		if (unlikely(read_u8(control, f, &control->eof))) {
			print_err("Failed to read eof flag in open_stream_in\n");
			goto failed;
		}
		print_maxverbose("EOF: %d\n", control->eof);

		/* Read in the expected chunk size */
		if (!ENCRYPT) {
			print_maxverbose("Reading expected chunksize at %lld\n", get_readseek(control, f));
			if (unlikely(read_val(control, f, &sinfo->size, sinfo->chunk_bytes))) {
				print_err("Failed to read in chunk size in open_stream_in\n");
				goto failed;
			}
			sinfo->size = le64toh(sinfo->size);
			print_maxverbose("Chunk size: %lld\n", sinfo->size);
			control->st_size += sinfo->size;
			if (unlikely(sinfo->chunk_bytes < 1 || sinfo->chunk_bytes > 8 || sinfo->size < 0)) {
				print_err("Invalid chunk data size %d bytes %lld\n", sinfo->size, sinfo->chunk_bytes);
				goto failed;
			}
		}
	}
	sinfo->initial_pos = get_readseek(control, f);
	if (unlikely(sinfo->initial_pos == -1))
		goto failed;

	for (i = 0; i < n; i++) {
		uchar c, enc_head[25 + SALT_LEN];
		i64 v1, v2;

		sinfo->s[i].base_thread = i;
		sinfo->s[i].uthread_no = sinfo->s[i].base_thread;
		sinfo->s[i].unext_thread = sinfo->s[i].base_thread;

		if (unlikely(ENCRYPT && read_buf(control, f, enc_head, SALT_LEN)))
			goto failed;
again:
		if (unlikely(read_u8(control, f, &c)))
			goto failed;

		/* Compatibility crap for versions < 0.40 */
		if (control->major_version == 0 && control->minor_version < 4) {
			u32 v132, v232, last_head32;

			if (unlikely(read_u32(control, f, &v132)))
				goto failed;
			if (unlikely(read_u32(control, f, &v232)))
				goto failed;
			if (unlikely(read_u32(control, f, &last_head32)))
				goto failed;

			v1 = v132;
			v2 = v232;
			sinfo->s[i].last_head = last_head32;
			header_length = 13;
		} else {
			int read_len;

			print_maxverbose("Reading stream %d header at %lld\n", i, get_readseek(control, f));
			if ((control->major_version == 0 && control->minor_version < 6) ||
				ENCRYPT)
					read_len = 8;
			else
				read_len = sinfo->chunk_bytes;
			if (unlikely(read_val(control, f, &v1, read_len)))
				goto failed;
			if (unlikely(read_val(control, f, &v2, read_len)))
				goto failed;
			if (unlikely(read_val(control, f, &sinfo->s[i].last_head, read_len)))
				goto failed;
			header_length = 1 + (read_len * 3);
		}
		sinfo->total_read += header_length;

		if (ENCRYPT) {
			if (unlikely(!decrypt_header(control, enc_head, &c, &v1, &v2, &sinfo->s[i].last_head)))
				goto failed;
			sinfo->total_read += SALT_LEN;
		}

		v1 = le64toh(v1);
		v2 = le64toh(v2);
		sinfo->s[i].last_head = le64toh(sinfo->s[i].last_head);

		if (unlikely(c == CTYPE_NONE && v1 == 0 && v2 == 0 && sinfo->s[i].last_head == 0 && i == 0)) {
			print_err("Enabling stream close workaround\n");
			sinfo->initial_pos += header_length;
			goto again;
		}

		if (unlikely(c != CTYPE_NONE)) {
			print_err("Unexpected initial tag %d in streams\n", c);
			if (ENCRYPT)
				print_err("Wrong password?\n");
			goto failed;
		}
		if (unlikely(v1)) {
			print_err("Unexpected initial c_len %lld in streams %lld\n", v1, v2);
			goto failed;
		}
		if (unlikely(v2)) {
			print_err("Unexpected initial u_len %lld in streams\n", v2);
			goto failed;
		}
	}

	return (void *)sinfo;

failed:
	dealloc(sinfo->s);
	dealloc(sinfo);
	dealloc(threads);
	dealloc(ucthreads);
	return NULL;
}

#define MIN_SIZE (ENCRYPT ? CBC_LEN : 0)

/* Once the final data has all been written to the block header, we go back
 * and write SALT_LEN bytes of salt before it, and encrypt the header in place
 * by reading what has been written, encrypting it, and writing back over it.
 * This is very convoluted depending on whether a last_head value is written
 * to this block or not. See the callers of this function */
static bool rewrite_encrypted(rzip_control *control, struct stream_info *sinfo, i64 ofs)
{
	uchar *buf, *head;
	i64 cur_ofs;

	cur_ofs = get_seek(control, sinfo->fd) - sinfo->initial_pos;
	if (unlikely(cur_ofs == -1))
		return false;
	head = malloc(25 + SALT_LEN);
	if (unlikely(!head))
		fatal_return(("Failed to malloc head in rewrite_encrypted\n"), false);
	buf = head + SALT_LEN;
	if (unlikely(!get_rand(control, head, SALT_LEN)))
		goto error;
	if (unlikely(seekto(control, sinfo, ofs - SALT_LEN)))
		failure_goto(("Failed to seekto buf ofs in rewrite_encrypted\n"), error);
	if (unlikely(write_buf(control, head, SALT_LEN)))
		failure_goto(("Failed to write_buf head in rewrite_encrypted\n"), error);
	if (unlikely(read_buf(control, sinfo->fd, buf, 25)))
		failure_goto(("Failed to read_buf buf in rewrite_encrypted\n"), error);

	if (unlikely(!lrz_encrypt(control, buf, 25, head)))
		goto error;

	if (unlikely(seekto(control, sinfo, ofs)))
		failure_goto(("Failed to seek back to ofs in rewrite_encrypted\n"), error);
	if (unlikely(write_buf(control, buf, 25)))
		failure_goto(("Failed to write_buf encrypted buf in rewrite_encrypted\n"), error);
	dealloc(head);
	seekto(control, sinfo, cur_ofs);
	return true;
error:
	dealloc(head);
	return false;
}

/* Enter with s_buf allocated,s_buf points to the compressed data after the
 * backend compression and is then freed here */
static void *compthread(void *data)
{
	stream_thread_struct *s = data;
	rzip_control *control = s->control;
	long i = s->i;
	struct compress_thread *cti;
	struct stream_info *ctis;
	int waited = 0, ret = 0;
	i64 padded_len;
	int write_len;

	/* Make sure this thread doesn't already exist */

	dealloc(data);
	cti = &cthreads[i];
	ctis = cti->sinfo;

	cti->c_type = CTYPE_NONE;
	cti->c_len = cti->s_len;

	/* Flushing writes to disk frees up any dirty ram, improving chances
	 * of succeeding in allocating more ram */

	/* This is a cludge in case we are compressing to stdout and our first
	 * stream is not compressed, but subsequent ones are compressed by
	 * lzma and we can no longer seek back to the beginning of the file
	 * to write the lzma properties which are effectively always starting
	 * with 93. */
	if (TMP_OUTBUF && LZMA_COMPRESS)
		control->lzma_properties[0] = 93;
retry:
	/* Very small buffers have issues to do with minimum amounts of ram
	 * allocatable to a buffer combined with the MINIMUM_MATCH of rzip
	 * being 31 bytes so don't bother trying to compress anything less
	 * than 64 bytes. */
	if (!NO_COMPRESS && cti->c_len >= 64) {
		if (LZMA_COMPRESS)
			ret = lzma_compress_buf(control, cti);
		else if (LZO_COMPRESS)
			ret = lzo_compress_buf(control, cti);
		else if (BZIP2_COMPRESS)
			ret = bzip2_compress_buf(control, cti);
		else if (ZLIB_COMPRESS)
			ret = gzip_compress_buf(control, cti);
		else if (ZPAQ_COMPRESS)
			ret = zpaq_compress_buf(control, cti, i);
		else failure_goto(("Dunno wtf compression to use!\n"), error);
	}

	padded_len = cti->c_len;
	if (!ret && padded_len < MIN_SIZE) {
		/* We need to pad out each block to at least be CBC_LEN bytes
		 * long or encryption cannot work. We pad it with random
		 * data */
		padded_len = MIN_SIZE;
		cti->s_buf = realloc(cti->s_buf, MIN_SIZE);
		if (unlikely(!cti->s_buf))
			fatal_goto(("Failed to realloc s_buf in compthread\n"), error);
		if (unlikely(!get_rand(control, cti->s_buf + cti->c_len, MIN_SIZE - cti->c_len)))
			goto error;
	}

	/* If compression fails for whatever reason multithreaded, then wait
	 * for the previous thread to finish, serialising the work to decrease
	 * the memory requirements, increasing the chance of success */
	if (unlikely(ret && waited))
		failure_goto(("Failed to compress in compthread\n"), error);

	if (!waited) {
		lock_mutex(control, &output_lock);
		while (output_thread != i)
			cond_wait(control, &output_cond, &output_lock);
		unlock_mutex(control, &output_lock);
		waited = 1;
	}
	if (unlikely(ret)) {
		print_maxverbose("Unable to compress in parallel, waiting for previous thread to complete before trying again\n");
		goto retry;
	}

	/* Need to be big enough to fill one CBC_LEN */
	if (ENCRYPT)
		write_len = 8;
	else
		write_len = ctis->chunk_bytes;

	if (!ctis->chunks++) {
		int j;

		if (STDOUT) {
			lock_mutex(control, &control->control_lock);
			if (!control->magic_written)
				write_magic(control);
			unlock_mutex(control, &control->control_lock);
		}

		print_maxverbose("Writing initial chunk bytes value %d at %lld\n",
				 ctis->chunk_bytes, get_seek(control, ctis->fd));
		/* Write chunk bytes of this block */
		write_u8(control, ctis->chunk_bytes);

		/* Write whether this is the last chunk, followed by the size
		 * of this chunk */
		print_maxverbose("Writing EOF flag as %d\n", control->eof);
		write_u8(control, control->eof);
		if (!ENCRYPT)
			write_val(control, ctis->size, ctis->chunk_bytes);

		/* First chunk of this stream, write headers */
		ctis->initial_pos = get_seek(control, ctis->fd);
		if (unlikely(ctis->initial_pos == -1))
			goto error;

		print_maxverbose("Writing initial header at %lld\n", ctis->initial_pos);
		for (j = 0; j < ctis->num_streams; j++) {
			/* If encrypting, we leave SALT_LEN room to write in salt
			* later */
			if (ENCRYPT) {
				if (unlikely(write_val(control, 0, SALT_LEN)))
					fatal_goto(("Failed to write_buf blank salt in compthread %d\n", i), error);
				ctis->cur_pos += SALT_LEN;
			}
			ctis->s[j].last_head = ctis->cur_pos + 1 + (write_len * 2);
			write_u8(control, CTYPE_NONE);
			write_val(control, 0, write_len);
			write_val(control, 0, write_len);
			write_val(control, 0, write_len);
			ctis->cur_pos += 1 + (write_len * 3);
		}
	}

	print_maxverbose("Compthread %ld seeking to %lld to store length %d\n", i, ctis->s[cti->streamno].last_head, write_len);

	if (unlikely(seekto(control, ctis, ctis->s[cti->streamno].last_head)))
		fatal_goto(("Failed to seekto in compthread %d\n", i), error);

	if (unlikely(write_val(control, ctis->cur_pos, write_len)))
		fatal_goto(("Failed to write_val cur_pos in compthread %d\n", i), error);

	if (ENCRYPT)
		rewrite_encrypted(control, ctis, ctis->s[cti->streamno].last_head - 17);

	ctis->s[cti->streamno].last_head = ctis->cur_pos + 1 + (write_len * 2) + (ENCRYPT ? SALT_LEN : 0);

	print_maxverbose("Compthread %ld seeking to %lld to write header\n", i, ctis->cur_pos);

	if (unlikely(seekto(control, ctis, ctis->cur_pos)))
		fatal_goto(("Failed to seekto cur_pos in compthread %d\n", i), error);

	print_maxverbose("Thread %ld writing %lld compressed bytes from stream %d\n", i, padded_len, cti->streamno);

	if (ENCRYPT) {
		if (unlikely(write_val(control, 0, SALT_LEN)))
			fatal_goto(("Failed to write_buf header salt in compthread %d\n", i), error);
		ctis->cur_pos += SALT_LEN;
		ctis->s[cti->streamno].last_headofs = ctis->cur_pos;
	}
	/* We store the actual c_len even though we might pad it out */
	if (unlikely(write_u8(control, cti->c_type) ||
		write_val(control, cti->c_len, write_len) ||
		write_val(control, cti->s_len, write_len) ||
		write_val(control, 0, write_len))) {
			fatal_goto(("Failed write in compthread %d\n", i), error);
	}
	ctis->cur_pos += 1 + (write_len * 3);

	if (ENCRYPT) {
		if (unlikely(!get_rand(control, cti->salt, SALT_LEN)))
			goto error;
		if (unlikely(write_buf(control, cti->salt, SALT_LEN)))
			fatal_goto(("Failed to write_buf block salt in compthread %d\n", i), error);
		if (unlikely(!lrz_encrypt(control, cti->s_buf, padded_len, cti->salt)))
			goto error;
		ctis->cur_pos += SALT_LEN;
	}

	print_maxverbose("Compthread %ld writing data at %lld\n", i, ctis->cur_pos);

	if (unlikely(write_buf(control, cti->s_buf, padded_len)))
		fatal_goto(("Failed to write_buf s_buf in compthread %d\n", i), error);

	ctis->cur_pos += padded_len;
	dealloc(cti->s_buf);

	lock_mutex(control, &output_lock);
	if (++output_thread == control->threads)
		output_thread = 0;
	cond_broadcast(control, &output_cond);
	unlock_mutex(control, &output_lock);

error:
	cksem_post(control, &cti->cksem);

	return NULL;
}

static void clear_buffer(rzip_control *control, struct stream_info *sinfo, int streamno, int newbuf)
{
	pthread_t *threads = control->pthreads;
	stream_thread_struct *s;
	static int i = 0;

	/* Make sure this thread doesn't already exist */
	cksem_wait(control, &cthreads[i].cksem);

	cthreads[i].sinfo = sinfo;
	cthreads[i].streamno = streamno;
	cthreads[i].s_buf = sinfo->s[streamno].buf;
	cthreads[i].s_len = sinfo->s[streamno].buflen;

	print_maxverbose("Starting thread %ld to compress %lld bytes from stream %d\n",
			 i, cthreads[i].s_len, streamno);

	s = malloc(sizeof(stream_thread_struct));
	if (unlikely(!s)) {
		cksem_post(control, &cthreads[i].cksem);
		failure("Unable to malloc in clear_buffer");
	}
	s->i = i;
	s->control = control;
	if (unlikely((!create_pthread(control, &threads[i], NULL, compthread, s)) ||
	             (!detach_pthread(control, &threads[i]))))
		failure("Unable to create compthread in clear_buffer");

	if (newbuf) {
		/* The stream buffer has been given to the thread, allocate a
		 * new one. */
		sinfo->s[streamno].buf = malloc(sinfo->bufsize);
		if (unlikely(!sinfo->s[streamno].buf))
			failure("Unable to malloc buffer of size %lld in flush_buffer\n", sinfo->bufsize);
		sinfo->s[streamno].buflen = 0;
	}

	if (++i == control->threads)
		i = 0;
}

/* flush out any data in a stream buffer */
void flush_buffer(rzip_control *control, struct stream_info *sinfo, int streamno)
{
	clear_buffer(control, sinfo, streamno, 1);
}

static void *ucompthread(void *data)
{
	stream_thread_struct *sts = data;
	rzip_control *control = sts->control;
	int waited = 0, ret = 0, i = sts->i;
	struct uncomp_thread *uci = &sts->sinfo->ucthreads[i];

	dealloc(data);

retry:
	if (uci->c_type != CTYPE_NONE) {
		switch (uci->c_type) {
			case CTYPE_LZMA:
				ret = lzma_decompress_buf(control, uci);
				break;
			case CTYPE_LZO:
				ret = lzo_decompress_buf(control, uci);
				break;
			case CTYPE_BZIP2:
				ret = bzip2_decompress_buf(control, uci);
				break;
			case CTYPE_GZIP:
				ret = gzip_decompress_buf(control, uci);
				break;
			case CTYPE_ZPAQ:
				ret = zpaq_decompress_buf(control, uci, i);
				break;
			default:
				failure_return(("Dunno wtf decompression type to use!\n"), NULL);
				break;
		}
	}

	/* As per compression, serialise the decompression if it fails in
	 * parallel */
	if (unlikely(ret)) {
		if (unlikely(waited))
			failure_return(("Failed to decompress in ucompthread\n"), (void*)1);
		print_maxverbose("Unable to decompress in parallel, waiting for previous thread to complete before trying again\n");
		/* We do not strictly need to wait for this, so it's used when
		 * decompression fails due to inadequate memory to try again
		 * serialised. */
		lock_mutex(control, &output_lock);
		while (output_thread != i)
			cond_wait(control, &output_cond, &output_lock);
		unlock_mutex(control, &output_lock);
		waited = 1;
		goto retry;
	}

	print_maxverbose("Thread %ld decompressed %lld bytes from stream %d\n", i, uci->u_len, uci->streamno);

	return NULL;
}

/* fill a buffer from a stream - return -1 on failure */
static int fill_buffer(rzip_control *control, struct stream_info *sinfo, struct stream *s, int streamno)
{
	i64 u_len, c_len, last_head, padded_len, header_length, max_len;
	uchar enc_head[25 + SALT_LEN], blocksalt[SALT_LEN];
	struct uncomp_thread *ucthreads = sinfo->ucthreads;
	pthread_t *threads = control->pthreads;
	stream_thread_struct *sts;
	uchar c_type, *s_buf;
	void *thr_return;

	dealloc(s->buf);
	if (s->eos)
		goto out;
fill_another:
	if (unlikely(ucthreads[s->uthread_no].busy))
		failure_return(("Trying to start a busy thread, this shouldn't happen!\n"), -1);

	if (unlikely(read_seekto(control, sinfo, s->last_head)))
		return -1;

	if (ENCRYPT) {
		if (unlikely(read_buf(control, sinfo->fd, enc_head, SALT_LEN)))
			return -1;
		sinfo->total_read += SALT_LEN;
	}

	if (unlikely(read_u8(control, sinfo->fd, &c_type)))
		return -1;

	/* Compatibility crap for versions < 0.4 */
	if (control->major_version == 0 && control->minor_version < 4) {
		u32 c_len32, u_len32, last_head32;

		if (unlikely(read_u32(control, sinfo->fd, &c_len32)))
			return -1;
		if (unlikely(read_u32(control, sinfo->fd, &u_len32)))
			return -1;
		if (unlikely(read_u32(control, sinfo->fd, &last_head32)))
			return -1;
		c_len = c_len32;
		u_len = u_len32;
		last_head = last_head32;
		header_length = 13;
	} else {
		int read_len;

		print_maxverbose("Reading ucomp header at %lld\n", get_readseek(control, sinfo->fd));
		if ((control->major_version == 0 && control->minor_version < 6) || ENCRYPT)
			read_len = 8;
		else
			read_len = sinfo->chunk_bytes;
		if (unlikely(read_val(control, sinfo->fd, &c_len, read_len)))
			return -1;
		if (unlikely(read_val(control, sinfo->fd, &u_len, read_len)))
			return -1;
		if (unlikely(read_val(control, sinfo->fd, &last_head, read_len)))
			return -1;
		header_length = 1 + (read_len * 3);
	}
	sinfo->total_read += header_length;

	if (ENCRYPT) {
		if (unlikely(!decrypt_header(control, enc_head, &c_type, &c_len, &u_len, &last_head)))
			return -1;
		if (unlikely(read_buf(control, sinfo->fd, blocksalt, SALT_LEN)))
			return -1;
		sinfo->total_read += SALT_LEN;
	}
	c_len = le64toh(c_len);
	u_len = le64toh(u_len);
	last_head = le64toh(last_head);
	print_maxverbose("Fill_buffer stream %d c_len %lld u_len %lld last_head %lld\n", streamno, c_len, u_len, last_head);

	/* It is possible for there to be an empty match block at the end of
	 * incompressible data */
	if (unlikely(c_len == 0 && u_len == 0 && streamno == 1 && last_head == 0)) {
		print_maxverbose("Skipping empty match block\n");
		goto skip_empty;
	}

	/* Check for invalid data and that the last_head is actually moving
	 * forward correctly. */
	if (unlikely(c_len < 1 || u_len < 1 || last_head < 0 || (last_head && last_head <= s->last_head))) {
		fatal_return(("Invalid data compressed len %lld uncompressed %lld last_head %lld\n",
			     c_len, u_len, last_head), -1);
	}

	padded_len = MAX(c_len, MIN_SIZE);
	sinfo->total_read += padded_len;

	if (unlikely(u_len > control->maxram))
		print_output("Warning, attempting to malloc very large buffer for this environment of size %lld\n", u_len);
	max_len = MAX(u_len, MIN_SIZE);
	max_len = MAX(max_len, c_len);
	s_buf = malloc(max_len);
	if (unlikely(!s_buf))
		fatal_return(("Unable to malloc buffer of size %lld in fill_buffer\n", u_len), -1);
	sinfo->ram_alloced += u_len;

	if (unlikely(read_buf(control, sinfo->fd, s_buf, padded_len))) {
		dealloc(s_buf);
		return -1;
	}

	if (unlikely(ENCRYPT && !lrz_decrypt(control, s_buf, padded_len, blocksalt))) {
		dealloc(s_buf);
		return -1;
	}

	ucthreads[s->uthread_no].s_buf = s_buf;
	ucthreads[s->uthread_no].c_len = c_len;
	ucthreads[s->uthread_no].u_len = u_len;
	ucthreads[s->uthread_no].c_type = c_type;
	ucthreads[s->uthread_no].streamno = streamno;
	s->last_head = last_head;

	/* List this thread as busy */
	ucthreads[s->uthread_no].busy = 1;
	print_maxverbose("Starting thread %ld to decompress %lld bytes from stream %d\n",
			 s->uthread_no, padded_len, streamno);

	sts = malloc(sizeof(stream_thread_struct));
	if (unlikely(!sts))
		fatal_return(("Unable to malloc in fill_buffer"), -1);
	sts->i = s->uthread_no;
	sts->control = control;
	sts->sinfo = sinfo;
	if (unlikely(!create_pthread(control, &threads[s->uthread_no], NULL, ucompthread, sts))) {
		dealloc(sts);
		return -1;
	}

	if (++s->uthread_no == s->base_thread + s->total_threads)
		s->uthread_no = s->base_thread;
skip_empty:
	/* Reached the end of this stream, no more data to read in, otherwise
	 * see if the next thread is free to grab more data. We also check that
	 * we're not going to be allocating too much ram to generate all these
	 * threads. */
	if (!last_head)
		s->eos = 1;
	else if (s->uthread_no != s->unext_thread && !ucthreads[s->uthread_no].busy &&
		 sinfo->ram_alloced < control->maxram)
			goto fill_another;
out:
	lock_mutex(control, &output_lock);
	output_thread = s->unext_thread;
	cond_broadcast(control, &output_cond);
	unlock_mutex(control, &output_lock);

	/* join_pthread here will make it wait till the data is ready */
	thr_return = NULL;
	if (unlikely(!join_pthread(control, threads[s->unext_thread], &thr_return) || !!thr_return))
		return -1;
	ucthreads[s->unext_thread].busy = 0;

	print_maxverbose("Taking decompressed data from thread %ld\n", s->unext_thread);
	s->buf = ucthreads[s->unext_thread].s_buf;
	ucthreads[s->unext_thread].s_buf = NULL;
	s->buflen = ucthreads[s->unext_thread].u_len;
	sinfo->ram_alloced -= s->buflen;
	s->bufp = 0;

	if (++s->unext_thread == s->base_thread + s->total_threads)
		s->unext_thread = s->base_thread;

	return 0;
}

/* write some data to a stream. Return -1 on failure */
void write_stream(rzip_control *control, void *ss, int streamno, uchar *p, i64 len)
{
	struct stream_info *sinfo = ss;

	while (len) {
		i64 n;

		n = MIN(sinfo->bufsize - sinfo->s[streamno].buflen, len);

		memcpy(sinfo->s[streamno].buf + sinfo->s[streamno].buflen, p, n);
		sinfo->s[streamno].buflen += n;
		p += n;
		len -= n;

		/* Flush the buffer every sinfo->bufsize into one thread */
		if (sinfo->s[streamno].buflen == sinfo->bufsize)
			flush_buffer(control, sinfo, streamno);
	}
}

/* read some data from a stream. Return number of bytes read, or -1
   on failure */
i64 read_stream(rzip_control *control, void *ss, int streamno, uchar *p, i64 len)
{
	struct stream_info *sinfo = ss;
	struct stream *s = &sinfo->s[streamno];
	i64 ret = 0;

	while (len) {
		i64 n;

		n = MIN(s->buflen - s->bufp, len);

		if (n > 0) {
			if (unlikely(!s->buf))
				failure_return(("Stream ran out prematurely, likely corrupt archive\n"), -1);
			memcpy(p, s->buf + s->bufp, n);
			s->bufp += n;
			p += n;
			len -= n;
			ret += n;
		}

		if (len && s->bufp == s->buflen) {
			if (unlikely(fill_buffer(control, sinfo, s, streamno)))
				return -1;
			if (s->bufp == s->buflen)
				break;
		}
	}

	return ret;
}

/* flush and close down a stream. return -1 on failure */
int close_stream_out(rzip_control *control, void *ss)
{
	struct stream_info *sinfo = ss;
	int i;

	for (i = 0; i < sinfo->num_streams; i++)
		clear_buffer(control, sinfo, i, 0);

	if (ENCRYPT) {
		/* Last two compressed blocks do not have an offset written
		 * to them so we have to go back and encrypt them now, but we
		 * must wait till the threads return. */
		int close_thread = output_thread;

		for (i = 0; i < control->threads; i++) {
			cksem_wait(control, &cthreads[close_thread].cksem);
			cksem_post(control, &cthreads[close_thread].cksem);
			if (++close_thread == control->threads)
				close_thread = 0;
		}
		for (i = 0; i < sinfo->num_streams; i++)
			rewrite_encrypted(control, sinfo, sinfo->s[i].last_headofs);
	}

	/* Note that sinfo->s and sinfo are not released here but after compression
	 * has completed as they cannot be freed immediately because their values
	 * are read after the next stream has started.
	 */

	return 0;
}

/* Add to an runzip list to safely deallocate memory after all threads have
 * returned. */
static void add_to_rulist(rzip_control *control, struct stream_info *sinfo)
{
	struct runzip_node *node = calloc(sizeof(struct runzip_node), 1);

	if (unlikely(!node))
		failure("Failed to calloc struct node in add_rulist\n");
	node->sinfo = sinfo;
	node->pthreads = control->pthreads;

	lock_mutex(control, &control->control_lock);
	node->prev = control->ruhead;
	control->ruhead = node;
	unlock_mutex(control, &control->control_lock);
}

/* close down an input stream */
int close_stream_in(rzip_control *control, void *ss)
{
	struct stream_info *sinfo = ss;
	int i;

	print_maxverbose("Closing stream at %lld, want to seek to %lld\n",
			 get_readseek(control, control->fd_in),
			 sinfo->initial_pos + sinfo->total_read);
	if (unlikely(read_seekto(control, sinfo, sinfo->total_read)))
		return -1;

	for (i = 0; i < sinfo->num_streams; i++)
		dealloc(sinfo->s[i].buf);

	output_thread = 0;
	/* We cannot safely release the sinfo and pthread data here till all
	 * threads are shut down. */
	add_to_rulist(control, sinfo);

	return 0;
}

/* As others are slow and lz4 very fast, it is worth doing a quick lz4 pass
   to see if there is any compression at all with lz4 first. It is unlikely
   that others will be able to compress if lz4 is unable to drop a single byte
   so do not compress any block that is incompressible by lz4. */
static int lz4_compresses(rzip_control *control, uchar *s_buf, i64 s_len)
{
	int dlen, test_len;
	char *c_buf = NULL, *test_buf = (char *)s_buf;
	int ret = 0;
	int workcounter = 0;	/* count # of passes */
	int best_dlen = INT_MAX; /* save best compression estimate */

	if (!LZ4_TEST)
		return 1;

	dlen = MIN(s_len, STREAM_BUFSIZE);
	test_len = MIN(dlen, STREAM_BUFSIZE >> 8);
	c_buf = malloc(dlen);
	if (unlikely(!c_buf))
		fatal_return(("Unable to allocate c_buf in lz4_compresses\n"), 0);

	/* Test progressively larger blocks at a time and as soon as anything
	   compressible is found, jump out as a success */
	do {
		int lz4_ret;

		workcounter++;
		lz4_ret = LZ4_compress_default((const char *)test_buf, c_buf, test_len, dlen);
		if (!lz4_ret) // Bigger than dlen
			lz4_ret = test_len;
		if (lz4_ret < best_dlen)
			best_dlen = lz4_ret;
		if (lz4_ret < test_len) {
			ret = 1;
			break;
		}
		/* expand test length */
		test_len <<= 1;
	} while (test_len <= dlen);

	if (!ret)
		print_maxverbose("lz4 testing FAILED for chunk %ld. %d Passes\n", workcounter);
	else {
		print_maxverbose("lz4 testing OK for chunk %ld. Compressed size = %5.2F%% of chunk, %d Passes\n",
				s_len, 100 * ((double) best_dlen / (double) test_len), workcounter);
	}

	dealloc(c_buf);

	return ret;
}
