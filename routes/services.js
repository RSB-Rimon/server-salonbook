import { Router } from "express";
import { ObjectId } from "mongodb";
import multer from "multer";

const SERVICE_STATUSES = ["active", "inactive"];

function escapeRegex(value) {
  return value
    .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/[{}]/g, "\\$&");
}

function normalizeService(input, isUpdate = false) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Send service information as an object." };
  }

  const allowedFields = [
    "serviceName",
    "category",
    "description",
    "price",
    "duration",
    "image",
    "status",
  ];
  const unknownField = Object.keys(input).find(
    (field) => !allowedFields.includes(field)
  );

  if (unknownField) {
    return { error: "The request contains an unsupported service field." };
  }

  const service = {};
  const textFields = {
    serviceName: 100,
    category: 60,
    description: 1500,
  };

  for (const [field, maxLength] of Object.entries(textFields)) {
    const wasSent = Object.prototype.hasOwnProperty.call(input, field);
    if (isUpdate && !wasSent) continue;

    const value = input[field];
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
      return { error: field + " is required and must be under " + maxLength + " characters." };
    }

    service[field] = value.trim();
  }

  for (const field of ["price", "duration"]) {
    const wasSent = Object.prototype.hasOwnProperty.call(input, field);
    if (isUpdate && !wasSent) continue;

    const value = Number(input[field]);
    const isValid = Number.isFinite(value) && value > 0;
    const isWholeNumber = field !== "duration" || Number.isInteger(value);

    if (!isValid || !isWholeNumber) {
      return { error: field + " must be a positive " + (field === "duration" ? "whole number." : "number.") };
    }

    service[field] = value;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(input, "image")) {
    if (typeof input.image !== "string") {
      return { error: "An image URL is required." };
    }

    try {
      const imageUrl = new URL(input.image);
      if (imageUrl.protocol !== "https:") {
        return { error: "The service image must use a secure HTTPS URL." };
      }
      service.image = imageUrl.toString();
    } catch {
      return { error: "Enter a valid HTTPS image URL." };
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "status")) {
    if (!SERVICE_STATUSES.includes(input.status)) {
      return { error: "Status must be active or inactive." };
    }
    service.status = input.status;
  } else if (!isUpdate) {
    service.status = "active";
  }

  if (Object.keys(service).length === 0) {
    return { error: "Provide at least one service field to update." };
  }

  return { data: service };
}

function readListOptions(req, res, activeOnly) {
  const filter = activeOnly ? { status: "active" } : {};
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const category =
    typeof req.query.category === "string" ? req.query.category.trim() : "";
  const sort = typeof req.query.sort === "string" ? req.query.sort : "";

  if (search.length > 100 || category.length > 60) {
    res.status(400).json({ message: "Search or category is too long." });
    return null;
  }

  if (search) {
    filter.serviceName = { $regex: escapeRegex(search), $options: "i" };
  }

  if (category) {
    filter.category = { $regex: "^" + escapeRegex(category) + "$", $options: "i" };
  }

  if (!activeOnly && typeof req.query.status === "string") {
    if (!SERVICE_STATUSES.includes(req.query.status)) {
      res.status(400).json({ message: "Status must be active or inactive." });
      return null;
    }
    filter.status = req.query.status;
  }

  let sortOption = { createdAt: -1 };
  if (sort === "price-asc") sortOption = { price: 1 };
  if (sort === "price-desc") sortOption = { price: -1 };

  if (sort && sort !== "price-asc" && sort !== "price-desc") {
    res.status(400).json({ message: "Sort must be price-asc or price-desc." });
    return null;
  }

  return { filter, sortOption };
}

function formatService(service) {
  return { ...service, _id: service._id.toString() };
}

function readServiceId(req, res) {
  const serviceId = req.params.serviceId;

  if (!ObjectId.isValid(serviceId)) {
    res.status(400).json({ message: "The service ID is invalid." });
    return null;
  }

  return new ObjectId(serviceId);
}

const serviceImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter(req, file, callback) {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.mimetype)) {
      return callback(new Error("Choose a JPG, PNG, or WEBP image."));
    }
    return callback(null, true);
  },
});

function receiveServiceImage(req, res, next) {
  serviceImageUpload.single("image")(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(statusCode).json({ message: "The image upload is invalid or too large." });
    }

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    return next();
  });
}

function hasValidImageSignature(file) {
  const buffer = file.buffer;

  if (file.mimetype === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (file.mimetype === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }

  if (file.mimetype === "image/webp") {
    return buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP";
  }

  return false;
}

async function uploadServiceImageToImgBB(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "Choose an image to upload." });
  }

  if (!hasValidImageSignature(req.file)) {
    return res.status(400).json({ message: "The selected file is not a valid image." });
  }

  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ message: "Image upload is not configured on the server." });
  }

  try {
    const extension = req.file.mimetype === "image/jpeg"
      ? "jpg"
      : req.file.mimetype === "image/png"
        ? "png"
        : "webp";
    const formData = new FormData();
    formData.append(
      "image",
      new Blob([req.file.buffer], { type: req.file.mimetype }),
      "salon-service." + extension
    );

    const uploadResponse = await fetch(
      "https://api.imgbb.com/1/upload?key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        body: formData,
      }
    );
    const uploadResult = await uploadResponse.json();

    if (
      !uploadResponse.ok ||
      uploadResult.success !== true ||
      typeof uploadResult.data?.url !== "string" ||
      !uploadResult.data.url.startsWith("https://")
    ) {
      return res.status(502).json({ message: "The image host could not save this image." });
    }

    return res.status(201).json({ imageUrl: uploadResult.data.url });
  } catch {
    return res.status(502).json({ message: "The image host could not be reached." });
  }
}
export function createServicesRouter({ db, requireAuth, requireRole }) {
  const router = Router();
  const services = db.collection("services");

  router.get("/services/categories", async (req, res) => {
    const categories = await services.distinct("category", { status: "active" });
    res.json({ categories: categories.sort((first, second) => first.localeCompare(second)) });
  });

  router.get("/services", async (req, res) => {
    const options = readListOptions(req, res, true);
    if (!options) return;

    const serviceList = await services
      .find(options.filter)
      .sort(options.sortOption)
      .toArray();

    res.json({ services: serviceList.map(formatService) });
  });

  router.get("/services/:serviceId", requireAuth, async (req, res) => {
    const serviceId = readServiceId(req, res);
    if (!serviceId) return;

    const service = await services.findOne({
      _id: serviceId,
      status: "active",
    });

    if (!service) {
      return res.status(404).json({ message: "Active service not found." });
    }

    res.json({ service: formatService(service) });
  });

  router.get("/admin/services", requireAuth, requireRole("admin"), async (req, res) => {
    const options = readListOptions(req, res, false);
    if (!options) return;

    const serviceList = await services
      .find(options.filter)
      .sort(options.sortOption)
      .toArray();

    res.json({ services: serviceList.map(formatService) });
  });

  router.post("/admin/services", requireAuth, requireRole("admin"), async (req, res) => {
    const result = normalizeService(req.body);
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }

    const service = {
      ...result.data,
      createdAt: new Date(),
    };
    const insertResult = await services.insertOne(service);

    res.status(201).json({
      message: "Service created.",
      service: formatService({ ...service, _id: insertResult.insertedId }),
    });
  });

  router.patch(
    "/admin/services/:serviceId",
    requireAuth,
    requireRole("admin"),
    async (req, res) => {
      const serviceId = readServiceId(req, res);
      if (!serviceId) return;

      const result = normalizeService(req.body, true);
      if (result.error) {
        return res.status(400).json({ message: result.error });
      }

      const updateResult = await services.updateOne(
        { _id: serviceId },
        { $set: result.data }
      );

      if (updateResult.matchedCount === 0) {
        return res.status(404).json({ message: "Service not found." });
      }

      const updatedService = await services.findOne({ _id: serviceId });
      res.json({
        message: "Service updated.",
        service: formatService(updatedService),
      });
    }
  );

  router.delete(
    "/admin/services/:serviceId",
    requireAuth,
    requireRole("admin"),
    async (req, res) => {
      const serviceId = readServiceId(req, res);
      if (!serviceId) return;

      const deleteResult = await services.deleteOne({ _id: serviceId });
      if (deleteResult.deletedCount === 0) {
        return res.status(404).json({ message: "Service not found." });
      }

      res.json({ message: "Service deleted." });
    }
  );

  router.post(
    "/admin/service-images",
    requireAuth,
    requireRole("admin"),
    receiveServiceImage,
    uploadServiceImageToImgBB
  );
  return router;
}