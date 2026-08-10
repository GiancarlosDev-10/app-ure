import { z } from 'zod';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (usar YYYY-MM-DD)');

export const createUserSchema = z.object({
  email: z.string().trim().email('Correo inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  role: z.enum(['admin', 'demo', 'paid']).default('demo'),
  active: z.boolean().default(true),
  expirationDate: dateStr.optional(),
  questionsLimit: z.number().int().positive().optional(),
});

export const updateUserSchema = z
  .object({
    role: z.enum(['admin', 'demo', 'paid']).optional(),
    active: z.boolean().optional(),
    expirationDate: dateStr.optional(),
    questionsLimit: z.number().int().positive().optional(),
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nada para actualizar.' });

export const createContentSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio').max(200),
  markdown: z.string().trim().min(1, 'El contenido markdown es obligatorio').max(200_000),
  assignedTo: z.string().uuid('Usuario inválido'),
});

export const updateContentSchema = z.object({
  active: z.boolean(),
});

export const generateQuestionSchema = z.object({
  contentId: z.string().uuid('Contenido inválido'),
  difficulty: z.enum(['basico', 'intermedio', 'avanzado']),
});

export const answerQuestionSchema = z.object({
  questionId: z.string().uuid('Pregunta inválida'),
  selectedIndex: z.number().int().min(0).max(3),
});
