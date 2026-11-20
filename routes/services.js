import { Router } from "express";
import { ObjectId } from "mongodb";

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

  return router;
}