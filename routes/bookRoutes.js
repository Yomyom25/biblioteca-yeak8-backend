// routes/bookRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ==========================
// CONFIGURACIÓN DE MULTER
// ==========================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir =
      file.fieldname === "coverImage" ? "uploads/covers" : "uploads/pdfs";
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

// Filtro de archivos
const fileFilter = (req, file, cb) => {
  if (file.fieldname === "pdfFiles") {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Solo se permiten archivos PDF"), false);
  } else if (file.fieldname === "coverImage") {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"), false);
  } else cb(null, true);
};

// Configuración principal de Multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB máximo por archivo
  },
});

// ==========================
// FUNCIONES AUXILIARES
// ==========================
const deleteUploadedFiles = (files) => {
  if (!files) return;
  Object.keys(files).forEach((fieldname) => {
    files[fieldname].forEach((file) => {
      if (fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          console.error("Error eliminando archivo:", e);
        }
      }
    });
  });
};

// ==========================
// RUTAS CON DB
// ==========================
module.exports = (dbPool) => {
  // GET / -> obtener todos los libros
  router.get("/", async (req, res) => {
    try {
      const [rows] = await dbPool.query(`
        SELECT 
          id_libro AS id,
          titulo,
          autor,
          categoria,
          tipo,
          ejemplares,
          estatus,
          link_archivo,
          link_imagen,
          YEAR(fecha_publicacion) AS ano
        FROM libros
        ORDER BY titulo ASC
      `);

      const host = req.protocol + "://" + req.get("host");
      const data = rows.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        autor: r.autor,
        categoria: r.categoria,
        tipo: r.tipo,
        ejemplares: r.ejemplares,
        estatus:
          r.estatus || (r.ejemplares > 0 ? "Disponible" : "No Disponible"),
        link_archivo: r.link_archivo,
        imagen: r.link_imagen
          ? `${host}/${r.link_imagen.replace(/^\/+/, "")}`
          : null,
        ano: r.ano || "N/A",
      }));

      res.json(data);
    } catch (error) {
      console.error("Error al obtener los libros:", error);
      res.status(500).json({ message: "Error al obtener los libros" });
    }
  });

  // POST /register -> registrar libro
  router.post(
    "/register",
    upload.fields([
      { name: "pdfFiles", maxCount: 5 },
      { name: "coverImage", maxCount: 1 },
    ]),
    async (req, res) => {
      console.log("\n📥 Datos recibidos:", req.body, req.files);

      try {
        let { titulo, autor, categoria, ano, tipo, ejemplares } = req.body;
        const pdfFiles = req.files?.pdfFiles || [];
        const coverImage = req.files?.coverImage
          ? req.files.coverImage[0]
          : null;

        // ========================
        // VALIDACIONES BÁSICAS
        // ========================
        if (!titulo?.trim())
          return res.status(400).json({ message: "El título es obligatorio." });
        if (!autor?.trim())
          return res.status(400).json({ message: "El autor es obligatorio." });
        if (!categoria?.trim())
          return res.status(400).json({ message: "La categoría es obligatoria." });

        if (!tipo || !["fisico", "digital"].includes(tipo))
          return res
            .status(400)
            .json({ message: "El tipo debe ser 'fisico' o 'digital'." });

        const currentYear = new Date().getFullYear();
        const year = parseInt(ano);
        if (!ano || isNaN(year))
          return res
            .status(400)
            .json({ message: "El año de publicación debe ser un número válido." });
        if (year < 1000 || year > currentYear)
          return res
            .status(400)
            .json({ message: `El año debe estar entre 1000 y ${currentYear}.` });

        ejemplares = parseInt(ejemplares, 10);
        if (tipo === "digital") ejemplares = 0;
        else if (isNaN(ejemplares) || ejemplares < 1)
          return res
            .status(400)
            .json({ message: "Debe haber al menos 1 ejemplar físico." });

        // ========================
        // VALIDACIONES DE ARCHIVOS
        // ========================
        if (tipo === "digital" && pdfFiles.length === 0) {
          deleteUploadedFiles(req.files);
          return res.status(400).json({
            message: "Los libros digitales requieren al menos un archivo PDF.",
          });
        }

        if (pdfFiles.length > 5) {
          deleteUploadedFiles(req.files);
          return res.status(400).json({
            message: "No se pueden subir más de 5 archivos PDF.",
          });
        }

        const totalPdfSize = pdfFiles.reduce((sum, f) => sum + f.size, 0);
        if (totalPdfSize > 2 * 1024 * 1024 * 1024) {
          deleteUploadedFiles(req.files);
          return res.status(400).json({
            message: "El tamaño total de los archivos PDF no debe exceder 2GB.",
          });
        }

        if (coverImage && coverImage.size > 5 * 1024 * 1024) {
          deleteUploadedFiles(req.files);
          return res.status(400).json({
            message: "La imagen de portada no debe exceder 5MB.",
          });
        }

        // ========================
        // VALIDAR DUPLICADOS
        // ========================
        const [existing] = await dbPool.query(
          "SELECT id_libro FROM libros WHERE titulo = ? AND autor = ?",
          [titulo.trim(), autor.trim()]
        );
        if (existing.length > 0) {
          deleteUploadedFiles(req.files);
          return res.status(409).json({
            message: "Ya existe un libro con el mismo título y autor.",
          });
        }

        // ========================
        // INSERTAR EN LA BASE DE DATOS
        // ========================
        const linkArchivos =
          pdfFiles.length > 0 ? pdfFiles.map((f) => f.path).join(",") : null;
        const linkImagen = coverImage ? coverImage.path : null;

        const query = `
          INSERT INTO libros 
          (titulo, autor, categoria, fecha_publicacion, estatus, link_archivo, link_imagen, tipo, ejemplares) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [result] = await dbPool.query(query, [
          titulo.trim(),
          autor.trim(),
          categoria.trim(),
          year,
          "disponible",
          linkArchivos,
          linkImagen,
          tipo,
          ejemplares,
        ]);

        res.status(201).json({
          message: "Libro registrado exitosamente.",
          id_libro: result.insertId,
        });
      } catch (error) {
        console.error("❌ Error en el servidor:", error);
        deleteUploadedFiles(req.files);

        if (error instanceof multer.MulterError) {
          if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              message: "El archivo excede el tamaño máximo permitido (2GB).",
            });
          }
          return res.status(400).json({
            message: `Error al subir archivo: ${error.message}`,
          });
        }

        res.status(500).json({
          message: "Error interno del servidor al registrar el libro.",
        });
      }
    }
  );

  return router;
};
