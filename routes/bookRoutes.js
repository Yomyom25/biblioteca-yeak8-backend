const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuración de Multer con validaciones
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    // Crear carpeta si no existe
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

// Filtro de archivos
const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'pdfFiles') {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'), false);
    }
  } else if (file.fieldname === 'coverImage') {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPG, PNG, WEBP)'), false);
    }
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB por archivo
  }
});

// Función para eliminar archivos en caso de error
const deleteUploadedFiles = (files) => {
  if (!files) return;
  
  Object.keys(files).forEach(fieldname => {
    files[fieldname].forEach(file => {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    });
  });
};

module.exports = (dbPool) => {

  router.post('/register', upload.fields([
    { name: 'pdfFiles', maxCount: 5 },
    { name: 'coverImage', maxCount: 1 }
  ]), async (req, res) => {
    
    // ========================================
    // 🔍 DEBUG: LOGS CRÍTICOS
    // ========================================
    console.log('\n========================================');
    console.log('📥 DATOS RECIBIDOS EN EL SERVIDOR');
    console.log('========================================');
    console.log('📦 req.body completo:', req.body);
    console.log('📦 req.files:', req.files);
    console.log('========================================\n');
    
    try {
      // Extraer datos del body (usar 'ano' sin tilde)
      let { titulo, autor, categoria, ano, tipo, ejemplares } = req.body;
      const pdfFiles = req.files?.pdfFiles || [];
      const coverImage = req.files?.coverImage ? req.files.coverImage[0] : null;

      // LOG para debugging
      console.log('📋 Datos extraídos:', { 
        titulo, 
        autor, 
        categoria, 
        ano, 
        tipo, 
        ejemplares 
      });

      // ============================================
      // VALIDACIONES DE CAMPOS OBLIGATORIOS
      // ============================================
      
      if (!titulo || !titulo.trim()) {
        console.log('❌ Error: Título faltante');
        deleteUploadedFiles(req.files);
        return res.status(400).json({ 
          message: "El título es obligatorio." 
        });
      }

      if (!autor || !autor.trim()) {
        console.log('❌ Error: Autor faltante');
        deleteUploadedFiles(req.files);
        return res.status(400).json({ 
          message: "El autor es obligatorio." 
        });
      }

      if (!categoria || !categoria.trim()) {
        console.log('❌ Error: Categoría faltante');
        deleteUploadedFiles(req.files);
        return res.status(400).json({ 
          message: "La categoría es obligatoria." 
        });
      }

      if (!tipo || !['fisico', 'digital'].includes(tipo)) {
        console.log('❌ Error: Tipo inválido o faltante');
        deleteUploadedFiles(req.files);
        return res.status(400).json({ 
          message: "El tipo debe ser 'fisico' o 'digital'." 
        });
      }

      // ============================================
      // VALIDACIÓN DE AÑO (NO FUTURO)
      // ============================================
      
      const currentYear = new Date().getFullYear();
      const year = parseInt(ano);

      if (!ano || isNaN(year)) {
        console.log('❌ Error: Año faltante o inválido. Recibido:', ano);
        deleteUploadedFiles(req.files);
        return res.status(400).json({ 
          message: "El año de publicación es obligatorio y debe ser un número." 
        });
      }

      if (year < 1000) {
        console.log('❌ Error: Año menor a 1000');
        deleteUploadedFiles(req.files);
        return res.status(400).json({ 
          message: "El año de publicación debe ser mayor a 1000." 
        });
      }

      if (year > currentYear) {
        console.log('❌ Error: Año futuro');
        deleteUploadedFiles(req.files);
        return res.status(400).json({ 
          message: `El año de publicación no puede ser mayor al año actual (${currentYear}).` 
        });
      }

      // ============================================
      // VALIDACIÓN Y CORRECCIÓN DE EJEMPLARES
      // ============================================
      
      ejemplares = parseInt(ejemplares, 10);

      if (tipo === 'digital') {
        // Los libros digitales SIEMPRE tienen 0 ejemplares físicos
        ejemplares = 0;
        console.log('ℹ️ Libro digital: ejemplares = 0');
      } else {
        // Para libros físicos, debe haber al menos 1 ejemplar
        if (isNaN(ejemplares) || ejemplares < 1) {
          console.log('❌ Error: Ejemplares inválido para libro físico');
          deleteUploadedFiles(req.files);
          return res.status(400).json({ 
            message: "Los libros físicos deben tener al menos 1 ejemplar." 
          });
        }

        if (ejemplares > 9999) {
          console.log('❌ Error: Ejemplares excede límite');
          deleteUploadedFiles(req.files);
          return res.status(400).json({ 
            message: "El número de ejemplares no puede exceder 9999." 
          });
        }
      }

      // ============================================
      // VALIDACIÓN DE ARCHIVOS
      // ============================================

      // Validar que libros digitales tengan al menos un PDF
      if (tipo === 'digital' && pdfFiles.length === 0) {
        console.log('❌ Error: Libro digital sin PDF');
        deleteUploadedFiles(req.files);
        return res.status(400).json({ 
          message: "Los libros digitales requieren al menos un archivo PDF." 
        });
      }

      // ============================================
      // VALIDACIÓN DE DUPLICADOS
      // ============================================
      
      const [existing] = await dbPool.query(
        'SELECT id_libro FROM libros WHERE titulo = ? AND autor = ?',
        [titulo.trim(), autor.trim()]
      );

      if (existing.length > 0) {
        console.log('❌ Error: Libro duplicado');
        deleteUploadedFiles(req.files);
        return res.status(409).json({ 
          message: "Ya existe un libro con el mismo título y autor." 
        });
      }

      // ============================================
      // PREPARAR DATOS PARA INSERCIÓN
      // ============================================
      
      const linkArchivos = pdfFiles.length > 0 
        ? pdfFiles.map(file => file.path).join(',') 
        : null;
      
      const linkImagen = coverImage ? coverImage.path : null;

      // Sanitizar datos
      const tituloClean = titulo.trim();
      const autorClean = autor.trim();
      const categoriaClean = categoria.trim();
      const fechaPublicacion = `${year}-01-01`;

      console.log('✅ Datos validados correctamente. Insertando en BD...');

      // ============================================
      // INSERTAR EN LA BASE DE DATOS
      // ============================================
      
      const query = `
        INSERT INTO libros 
        (titulo, autor, categoria, fecha_publicacion, estatus, link_archivo, link_imagen, tipo, ejemplares) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const [result] = await dbPool.query(query, [
        tituloClean,
        autorClean,
        categoriaClean,
        fechaPublicacion,
        'disponible',
        linkArchivos,
        linkImagen,
        tipo,
        ejemplares
      ]);

      // ============================================
      // RESPUESTA EXITOSA
      // ============================================
      
      console.log('✅ Libro registrado exitosamente. ID:', result.insertId);
      console.log('========================================\n');

      res.status(201).json({
        message: "Libro registrado exitosamente",
        id_libro: result.insertId,
        datos: {
          titulo: tituloClean,
          autor: autorClean,
          tipo: tipo,
          ejemplares: ejemplares,
          año: year
        }
      });

    } catch (error) {
      console.error('\n❌❌❌ ERROR EN EL SERVIDOR ❌❌❌');
      console.error('Error completo:', error);
      console.error('Stack:', error.stack);
      console.error('========================================\n');
      
      // Eliminar archivos subidos en caso de error
      deleteUploadedFiles(req.files);

      // Error de Multer
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ 
            message: "El archivo excede el tamaño máximo permitido (10MB)." 
          });
        }
        return res.status(400).json({ 
          message: `Error al subir archivo: ${error.message}` 
        });
      }

      // Error de validación de archivos
      if (error.message.includes('Solo se permiten')) {
        return res.status(400).json({ 
          message: error.message 
        });
      }

      // Error de base de datos
      if (error.code === 'ER_NO_SUCH_TABLE') {
        return res.status(500).json({ 
          message: "Error de configuración de base de datos. Contacte al administrador." 
        });
      }

      if (error.code === 'ER_BAD_FIELD_ERROR') {
        return res.status(500).json({ 
          message: "Error de configuración de base de datos (campo faltante). Contacte al administrador." 
        });
      }

      // Error genérico
      res.status(500).json({ 
        message: "Error interno del servidor al registrar el libro." 
      });
    }
  });

  return router;
};