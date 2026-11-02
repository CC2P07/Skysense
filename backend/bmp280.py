
from micropython import const
import time

_REG_ID = const(0xD0)
_REG_RESET = const(0xE0)
_REG_CTRL_MEAS = const(0xF4)
_REG_CONFIG = const(0xF5)
_REG_PRESS_MSB = const(0xF7)
_REG_CALIB = const(0x88)

class BMP280:
    def __init__(self, i2c, address=0x76):
        self.i2c = i2c
        self.address = address

        if address not in i2c.scan():
            raise OSError("BMP280 nao encontrado")

        chip_id = i2c.readfrom_mem(address, _REG_ID, 1)[0]
        if chip_id != 0x58:
            raise OSError("ID BMP280 invalido: " + hex(chip_id))

        self.dig_T1 = self._u16(0x88)
        self.dig_T2 = self._s16(0x8A)
        self.dig_T3 = self._s16(0x8C)
        self.dig_P1 = self._u16(0x8E)
        self.dig_P2 = self._s16(0x90)
        self.dig_P3 = self._s16(0x92)
        self.dig_P4 = self._s16(0x94)
        self.dig_P5 = self._s16(0x96)
        self.dig_P6 = self._s16(0x98)
        self.dig_P7 = self._s16(0x9A)
        self.dig_P8 = self._s16(0x9C)
        self.dig_P9 = self._s16(0x9E)

        self.i2c.writeto_mem(address, _REG_RESET, b'\xB6')
        time.sleep_ms(100)
        self.i2c.writeto_mem(address, _REG_CTRL_MEAS, b'\x27')
        self.i2c.writeto_mem(address, _REG_CONFIG, b'\xA0')
        time.sleep_ms(100)

    def _u16(self, reg):
        return int.from_bytes(
            self.i2c.readfrom_mem(self.address, reg, 2), 'little'
        )

    def _s16(self, reg):
        value = self._u16(reg)
        return value - 65536 if value > 32767 else value

    @property
    def pressure(self):
        data = self.i2c.readfrom_mem(self.address, _REG_PRESS_MSB, 6)

        adc_p = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4)
        adc_t = (data[3] << 12) | (data[4] << 4) | (data[5] >> 4)

        var1 = (((adc_t >> 3) - (self.dig_T1 << 1)) *
                self.dig_T2) >> 11
        var2 = (((((adc_t >> 4) - self.dig_T1) *
                  ((adc_t >> 4) - self.dig_T1)) >> 12) *
                self.dig_T3) >> 14
        t_fine = var1 + var2

        var1 = t_fine - 128000
        var2 = var1 * var1 * self.dig_P6
        var2 += (var1 * self.dig_P5) << 17
        var2 += self.dig_P4 << 35
        var1 = ((var1 * var1 * self.dig_P3) >> 8)
        var1 += ((var1 * self.dig_P2) << 12)
        var1 = (((1 << 47) + var1) * self.dig_P1) >> 33

        if var1 == 0:
            raise ValueError("Erro na calibracao do BMP280")

        p = 1048576 - adc_p
        p = (((p << 31) - var2) * 3125) // var1
        var1 = (self.dig_P9 * (p >> 13) * (p >> 13)) >> 25
        var2 = (self.dig_P8 * p) >> 19
        p = ((p + var1 + var2) >> 8) + (self.dig_P7 << 4)

        return p / 256

