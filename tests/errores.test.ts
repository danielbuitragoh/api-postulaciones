import { describe, expect, it } from 'vitest';
import { NoEncontrado } from '../src/errores.js';

describe('NoEncontrado', () => {
  it('concuerda en género con el recurso', () => {
    expect(new NoEncontrado('Postulación').message).toBe('Postulación no encontrada');
    expect(new NoEncontrado('Ruta').message).toBe('Ruta no encontrada');
    expect(new NoEncontrado('Recurso').message).toBe('Recurso no encontrado');
  });
});
