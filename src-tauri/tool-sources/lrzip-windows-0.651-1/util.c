/*
   Copyright (C) 2006-2016,2021-2022 Con Kolivas
   Copyright (C) 2011 Serge Belyshev
   Copyright (C) 2008, 2011 Peter Hyman
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

/*
  Utilities used in rzip

  tridge, June 1996
  */

/*
 * Realloc removed
 * Functions added
 *    read_config()
 * Peter Hyman, December 2008
 */

#ifdef HAVE_CONFIG_H
# include "config.h"
#endif

#include <stdarg.h>
#ifdef HAVE_UNISTD_H
# include <unistd.h>
#endif

#ifdef _SC_PAGE_SIZE
# define PAGE_SIZE (sysconf(_SC_PAGE_SIZE))
#else
# define PAGE_SIZE (4096)
#endif

#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include "lrzip_private.h"
#include "util.h"
#include "sha4.h"
#include "aes.h"
#ifdef HAVE_CTYPE_H
# include <ctype.h>
#endif

#if defined(_WIN32) || defined(_WIN64)
#include "mman.h"
#endif
#include "misc.h"

/* Macros for testing parameters */
#define isparameter( parmstring, value )	(!strcasecmp( parmstring, value ))
#define iscaseparameter( parmvalue, value )	(!strcmp( parmvalue, value ))

void register_infile(rzip_control *control, const char *name, char delete)
{
	control->util_infile = name;
	control->delete_infile = delete;
}

void register_outfile(rzip_control *control, const char *name, char delete)
{
	control->util_outfile = name;
	control->delete_outfile = delete;
}

void register_outputfile(rzip_control *control, FILE *f)
{
	control->outputfile = f;
}

void unlink_files(rzip_control *control)
{
	/* Delete temporary files generated for testing or faking stdio */
	if (control->util_outfile && control->delete_outfile)
		unlink(control->util_outfile);

	if (control->util_infile && control->delete_infile)
		unlink(control->util_infile);
}

void fatal_exit(rzip_control *control)
{
	unlink_files(control);
	if (!STDOUT && !TEST_ONLY && control->outfile) {
		if (!KEEP_BROKEN) {
			print_verbose("Deleting broken file %s\n", control->outfile);
			unlink(control->outfile);
		} else
			print_verbose("Keeping broken file %s as requested\n", control->outfile);
	}
	fprintf(control->outputfile, "Fatal error - exiting\n");
	fflush(control->outputfile);
	exit(1);
}

void setup_overhead(rzip_control *control)
{
	/* Work out the compression overhead per compression thread for the
	 * compression back-ends that need a lot of ram */
	if (LZMA_COMPRESS) {
		int level = control->compression_level * 7 / 9;

		if (!level)
			level = 1;
		i64 dictsize = (level <= 5 ? (1 << (level * 2 + 14)) :
				(level == 6 ? (1 << 25) : (1 << 26)));

		control->overhead = (dictsize * 23 / 2) + (6 * 1024 * 1024) + 16384;
		/* LZMA spec shows memory requirements as 6MB, not 4MB and state size
		 * where default is 16KB */
	} else if (ZPAQ_COMPRESS)
		control->overhead = 112 * 1024 * 1024;
}

void setup_ram(rzip_control *control)
{
	/* Use less ram when using STDOUT to store the temporary output file. */
	if (STDOUT && ((STDIN && DECOMPRESS) || !(DECOMPRESS || TEST_ONLY)))
		control->maxram = control->ramsize / 6;
	else
		control->maxram = control->ramsize / 3;
	if (BITS32) {
		/* Decrease usable ram size on 32 bits due to kernel /
		 * userspace split. Cannot allocate larger than a 1
		 * gigabyte chunk due to 32 bit signed long being
		 * used in alloc, and at most 3GB can be malloced, and
		 * 2/3 of that makes for a total of 2GB to be split
		 * into thirds.
		 */
		control->usable_ram = MAX(control->ramsize - 900000000ll, 900000000ll);
		control->maxram = MIN(control->maxram, control->usable_ram);
		control->maxram = MIN(control->maxram, one_g * 2 / 3);
	} else
		control->usable_ram = control->maxram;
	round_to_page(&control->maxram);
}

void round_to_page(i64 *size)
{
	*size -= *size % PAGE_SIZE;
	if (unlikely(!*size))
		*size = PAGE_SIZE;
}

size_t round_up_page(rzip_control *control, size_t len)
{
	int rem = len % control->page_size;

	if (rem)
		len += control->page_size - rem;
	return len;
}

bool get_rand(rzip_control *control, uchar *buf, int len)
{
	for (int i = 0; i < len; i++)
		buf[i] = (uchar)get_random_32();
	return true;
}

bool read_config(rzip_control *control)
{
	/* check for lrzip.conf in ., $HOME/.lrzip and /etc/lrzip */
	char *HOME, homeconf[255];
	char *parametervalue;
	char *parameter;
	char line[255];
	FILE *fp;

	fp = fopen("lrzip.conf", "rb");
	if (fp)
		fprintf(control->msgout, "Using configuration file ./lrzip.conf\n");
	if (fp == NULL) {
		HOME=getenv("HOME");
		if (HOME) {
			snprintf(homeconf, sizeof(homeconf), "%s/.lrzip/lrzip.conf", HOME);
			fp = fopen(homeconf, "rb");
			if (fp)
				fprintf(control->msgout, "Using configuration file %s\n", homeconf);
		}
	}
	if (fp == NULL) {
		fp = fopen("/etc/lrzip/lrzip.conf", "rb");
		if (fp)
			fprintf(control->msgout, "Using configuration file /etc/lrzip/lrzip.conf\n");
	}
	if (fp == NULL)
		return false;

	/* if we get here, we have a file. read until no more. */

	while ((fgets(line, 255, fp)) != NULL) {
		if (strlen(line))
			line[strlen(line) - 1] = '\0';
		parameter = strtok(line, " =");
		if (parameter == NULL)
			continue;
		/* skip if whitespace or # */
		if (isspace(*parameter))
			continue;
		if (*parameter == '#')
			continue;

		parametervalue = strtok(NULL, " =");
		if (parametervalue == NULL)
			continue;

		/* have valid parameter line, now assign to control */

		if (isparameter(parameter, "window"))
			control->window = atoi(parametervalue);
		else if (isparameter(parameter, "unlimited")) {
			if (isparameter(parametervalue, "yes"))
				control->flags |= FLAG_UNLIMITED;
		} else if (isparameter(parameter, "compressionlevel")) {
			control->compression_level = atoi(parametervalue);
			if ( control->compression_level < 1 || control->compression_level > 9 )
				failure_return(("CONF.FILE error. Compression Level must between 1 and 9"), false);
		} else if (isparameter(parameter, "compressionmethod")) {
			/* valid are rzip, gzip, bzip2, lzo, lzma (default), and zpaq */
			if (control->flags & FLAG_NOT_LZMA)
				failure_return(("CONF.FILE error. Can only specify one compression method"), false);
			if (isparameter(parametervalue, "bzip2"))
				control->flags |= FLAG_BZIP2_COMPRESS;
			else if (isparameter(parametervalue, "gzip"))
				control->flags |= FLAG_ZLIB_COMPRESS;
			else if (isparameter(parametervalue, "lzo"))
				control->flags |= FLAG_LZO_COMPRESS;
			else if (isparameter(parametervalue, "rzip"))
				control->flags |= FLAG_NO_COMPRESS;
			else if (isparameter(parametervalue, "zpaq"))
				control->flags |= FLAG_ZPAQ_COMPRESS;
			else if (!isparameter(parametervalue, "lzma")) /* oops, not lzma! */
				failure_return(("CONF.FILE error. Invalid compression method %s specified\n",parametervalue), false);
		} else if (isparameter(parameter, "lzotest")) {
			/* default is yes */
			if (isparameter(parametervalue, "no"))
				control->flags &= ~FLAG_THRESHOLD;
		} else if (isparameter(parameter, "hashcheck")) {
			if (isparameter(parametervalue, "yes")) {
				control->flags |= FLAG_CHECK;
				control->flags |= FLAG_HASH;
			}
		} else if (isparameter(parameter, "showhash")) {
			if (isparameter(parametervalue, "yes"))
				control->flags |= FLAG_HASH;
		} else if (isparameter(parameter, "outputdirectory")) {
			control->outdir = malloc(strlen(parametervalue) + 2);
			if (!control->outdir)
				fatal_return(("Fatal Memory Error in read_config"), false);
			strcpy(control->outdir, parametervalue);
			if (strcmp(parametervalue + strlen(parametervalue) - 1, "/"))
				strcat(control->outdir, "/");
		} else if (isparameter(parameter,"verbosity")) {
			if (control->flags & FLAG_VERBOSE)
				failure_return(("CONF.FILE error. Verbosity already defined."), false);
			if (isparameter(parametervalue, "yes"))
				control->flags |= FLAG_VERBOSITY;
			else if (isparameter(parametervalue,"max"))
				control->flags |= FLAG_VERBOSITY_MAX;
			else /* oops, unrecognized value */
				print_err("lrzip.conf: Unrecognized verbosity value %s. Ignored.\n", parametervalue);
		} else if (isparameter(parameter, "showprogress")) {
			/* Yes by default */
			if (isparameter(parametervalue, "NO"))
				control->flags &= ~FLAG_SHOW_PROGRESS;
		} else if (isparameter(parameter,"nice")) {
			control->nice_val = atoi(parametervalue);
			if (control->nice_val < -20 || control->nice_val > 19)
				failure_return(("CONF.FILE error. Nice must be between -20 and 19"), false);
		} else if (isparameter(parameter, "keepbroken")) {
			if (isparameter(parametervalue, "yes" ))
				control->flags |= FLAG_KEEP_BROKEN;
		} else if (iscaseparameter(parameter, "DELETEFILES")) {
			/* delete files must be case sensitive */
			if (iscaseparameter(parametervalue, "YES"))
				control->flags &= ~FLAG_KEEP_FILES;
		} else if (iscaseparameter(parameter, "REPLACEFILE")) {
			/* replace lrzip file must be case sensitive */
			if (iscaseparameter(parametervalue, "YES"))
				control->flags |= FLAG_FORCE_REPLACE;
		} else if (isparameter(parameter, "tmpdir")) {
			control->tmpdir = realloc(NULL, strlen(parametervalue) + 2);
			if (!control->tmpdir)
				fatal_return(("Fatal Memory Error in read_config"), false);
			strcpy(control->tmpdir, parametervalue);
			if (strcmp(parametervalue + strlen(parametervalue) - 1, "/"))
				strcat(control->tmpdir, "/");
		} else if (isparameter(parameter, "encrypt")) {
			if (isparameter(parameter, "YES"))
				control->flags |= FLAG_ENCRYPT;
		} else
			/* oops, we have an invalid parameter, display */
			print_err("lrzip.conf: Unrecognized parameter value, %s = %s. Continuing.\n",\
				       parameter, parametervalue);
	}

	if (unlikely(fclose(fp)))
		fatal_return(("Failed to fclose fp in read_config\n"), false);

/*	fprintf(stderr, "\nWindow = %d \
		\nCompression Level = %d \
		\nThreshold = %1.2f \
		\nOutput Directory = %s \
		\nFlags = %d\n", control->window,control->compression_level, control->threshold, control->outdir, control->flags);
*/
	return true;
}

static void xor128 (void *pa, const void *pb)
{
	i64 *a = pa;
	const i64 *b = pb;

	a [0] ^= b [0];
	a [1] ^= b [1];
}

static void lrz_keygen(const rzip_control *control, const uchar *salt, uchar *key, uchar *iv)
{
	uchar buf [HASH_LEN + SALT_LEN + PASS_LEN];
	mlock(buf, HASH_LEN + SALT_LEN + PASS_LEN);

	memcpy(buf, control->hash, HASH_LEN);
	memcpy(buf + HASH_LEN, salt, SALT_LEN);
	memcpy(buf + HASH_LEN + SALT_LEN, control->salt_pass, control->salt_pass_len);
	sha4(buf, HASH_LEN + SALT_LEN + control->salt_pass_len, key, 0);

	memcpy(buf, key, HASH_LEN);
	memcpy(buf + HASH_LEN, salt, SALT_LEN);
	memcpy(buf + HASH_LEN + SALT_LEN, control->salt_pass, control->salt_pass_len);
	sha4(buf, HASH_LEN + SALT_LEN + control->salt_pass_len, iv, 0);

	memset(buf, 0, sizeof(buf));
	munlock(buf, sizeof(buf));
}

bool lrz_crypt(const rzip_control *control, uchar *buf, i64 len, const uchar *salt, int encrypt)
{
	/* Encryption requires CBC_LEN blocks so we can use ciphertext
	* stealing to not have to pad the block */
	uchar key[HASH_LEN], iv[HASH_LEN];
	uchar tmp0[CBC_LEN], tmp1[CBC_LEN];
	aes_context aes_ctx;
	i64 N, M;
	bool ret = false;

	/* Generate unique key and IV for each block of data based on salt */
	mlock(&aes_ctx, sizeof(aes_ctx));
	mlock(key, HASH_LEN);
	mlock(iv, HASH_LEN);

	lrz_keygen(control, salt, key, iv);

	M = len % CBC_LEN;
	N = len - M;

	if (encrypt == LRZ_ENCRYPT) {
		print_maxverbose("Encrypting data        \n");
		if (unlikely(aes_setkey_enc(&aes_ctx, key, 128)))
			failure_goto(("Failed to aes_setkey_enc in lrz_crypt\n"), error);
		aes_crypt_cbc(&aes_ctx, AES_ENCRYPT, N, iv, buf, buf);

		if (M) {
			memset(tmp0, 0, CBC_LEN);
			memcpy(tmp0, buf + N, M);
			aes_crypt_cbc(&aes_ctx, AES_ENCRYPT, CBC_LEN,
				iv, tmp0, tmp1);
			memcpy(buf + N, buf + N - CBC_LEN, M);
			memcpy(buf + N - CBC_LEN, tmp1, CBC_LEN);
		}
	} else {
		if (unlikely(aes_setkey_dec(&aes_ctx, key, 128)))
			failure_goto(("Failed to aes_setkey_dec in lrz_crypt\n"), error);
		print_maxverbose("Decrypting data        \n");
		if (M) {
			aes_crypt_cbc(&aes_ctx, AES_DECRYPT, N - CBC_LEN,
				      iv, buf, buf);
			aes_crypt_ecb(&aes_ctx, AES_DECRYPT,
				      buf + N - CBC_LEN, tmp0);
			memset(tmp1, 0, CBC_LEN);
			memcpy(tmp1, buf + N, M);
			xor128(tmp0, tmp1);
			memcpy(buf + N, tmp0, M);
			memcpy(tmp1 + M, tmp0 + M, CBC_LEN - M);
			aes_crypt_ecb(&aes_ctx, AES_DECRYPT, tmp1,
				      buf + N - CBC_LEN);
			xor128(buf + N - CBC_LEN, iv);
		} else
			aes_crypt_cbc(&aes_ctx, AES_DECRYPT, len,
				      iv, buf, buf);
	}

	ret = true;
error:
	memset(&aes_ctx, 0, sizeof(aes_ctx));
	memset(iv, 0, HASH_LEN);
	memset(key, 0, HASH_LEN);
	munlock(&aes_ctx, sizeof(aes_ctx));
	munlock(iv, HASH_LEN);
	munlock(key, HASH_LEN);
	return ret;
}

void lrz_stretch(rzip_control *control)
{
	sha4_context ctx;
	i64 j, n, counter;

	mlock(&ctx, sizeof(ctx));
	sha4_starts(&ctx, 0);

	n = control->encloops * HASH_LEN / (control->salt_pass_len + sizeof(i64));
	print_maxverbose("Hashing passphrase %lld (%lld) times \n", control->encloops, n);
	for (j = 0; j < n; j ++) {
		counter = htole64(j);
		sha4_update(&ctx, (uchar *)&counter, sizeof(counter));
		sha4_update(&ctx, control->salt_pass, control->salt_pass_len);
	}
	sha4_finish(&ctx, control->hash);
	memset(&ctx, 0, sizeof(ctx));
	munlock(&ctx, sizeof(ctx));
}
