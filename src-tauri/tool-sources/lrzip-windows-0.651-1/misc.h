#ifndef LRZIP_WINDOWS_MISC_H
#define LRZIP_WINDOWS_MISC_H

#ifdef __cplusplus
extern "C" {
#endif // __cplusplus

int get_random_16();
int get_random_32();

void init_rand();

unsigned int get_threads();

#ifdef __cplusplus
};
#endif // __cplusplus

#endif //LRZIP_WINDOWS_MISC_H
