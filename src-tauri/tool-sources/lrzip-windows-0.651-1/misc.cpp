#include "misc.h"

#include <random>
#include <chrono>
#include <thread>

static std::mt19937* generator;

void init_rand() {
	using namespace std::chrono;
	generator = new std::mt19937(time_point_cast<nanoseconds>(system_clock::now()).time_since_epoch().count());
}

int get_random_16() {
	std::uniform_int_distribution<int> distribution(0, 0xFFFF);
	return distribution(*generator);
}

int get_random_32() {
	return generator->operator()();
}

unsigned int get_threads() {
	return std::thread::hardware_concurrency();
}
