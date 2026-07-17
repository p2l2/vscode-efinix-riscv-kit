
// Efinix Headers for rv32 assume you are programming in C and are missing
// a extern "C" guarded with #ifdef __cplusplus.
// For correct operation in mixed C/C++ environments, all efinix headers must be included in an extern "C" block.
extern "C" {
#include "bsp.h"
#include "print.h"
}

extern "C" void trap() {
    // Called from efinix trap.S
    // Implement your Interrupt and exception handler here
    // Default: loop forever
    while(1) {

    }
}

int main (int argc, char *argv[]) {
    bsp_init();
    bsp_printf("Starting... \r\n");

    while(1) {
        bsp_uDelay(1000000);
        bsp_printf("Hello from Efinix\r\n");
    }
}
